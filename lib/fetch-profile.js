// Run: node fetch-profile.js <profile-url>
// The consolidated pipeline: one function, profile URL in, full structured
// JSON out. Pure HTTP throughout -- zero browser at request-time. Reuses
// templates.json (captured once via a one-time browser recon pass) for
// headers/cookies/body shapes, swapping in the target profile's slug per
// request.

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { parseFlightStream, resolveAll, extractStrings } = require('./flight-resolver');
const { extractSectionsFromResponse, cleanStrings } = require('./flight-extract');
const { parseExperienceSection, parseEducationSection, parseCertificationSection, parseSkillsSelfView } = require('./parsers');

// __dirname-relative, not CWD-relative -- works regardless of where the
// process is launched from (matters once this is required by src/server.js
// running from the project root instead of invoked directly as a CLI)
const TEMPLATES_PATH = path.join(__dirname, 'templates.json');

function loadTemplates() {
  if (!fs.existsSync(TEMPLATES_PATH)) {
    throw new Error(
      `${TEMPLATES_PATH} not found (see README setup instructions).`
    );
  }
  return JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
}

const templates = loadTemplates();

const COMPONENT_IDS = {
  aboveActivity: 'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsAboveActivity',
  experience: 'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsExperienceOnly',
  part1: 'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart1WithoutExp',
  skills: 'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart7',
  languages: 'com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart4',
};

// Derives the csrf-token header from the JSESSIONID cookie value -- the
// two are always the same value (JSESSIONID="ajax:123" in the cookie,
// csrf-token: ajax:123 unquoted in the header), confirmed on real
// requests. Means only ONE secret needs to be supplied (the full cookie
// string), not two.
function deriveCsrfToken(cookieString) {
  const m = cookieString && cookieString.match(/JSESSIONID="?([^;"]+)"?/);
  return m ? m[1] : null;
}

// lib/templates.json is committed to the repo (the request SHAPE isn't
// secret) with its captured cookie/csrf-token values redacted. The real
// session cookie is supplied at runtime via LINKEDIN_COOKIE -- an env var
// takes priority when set; falls back to whatever's baked into the
// template otherwise (convenient for local dev against a freshly
// re-captured, not-yet-redacted templates.json).
function stripHopHeaders(headers) {
  const h = { ...headers };
  delete h[':authority']; delete h[':method']; delete h[':path']; delete h[':scheme'];
  delete h['content-length'];

  const cookieOverride = process.env.LINKEDIN_COOKIE;
  if (cookieOverride) {
    h.cookie = cookieOverride;
    const csrf = deriveCsrfToken(cookieOverride);
    if (csrf) h['csrf-token'] = csrf;
  }
  return h;
}

// --- componentId-style fetch (About/topcard-bundle, Experience preview,
// Part1 bundle, Skills preview, Languages) ---
async function fetchComponent(slug, componentId, signal) {
  const entry = templates.componentTemplate;
  const originalSlug = JSON.parse(entry.postData).clientArguments.payload.vanityName;

  const headers = stripHopHeaders(entry.headers);
  let url = entry.url.replaceAll(originalSlug, slug);
  url = url.replace(/componentId=[^&]+/, 'componentId=' + encodeURIComponent(componentId));
  url = url.replace(/sduiid=[^&]+/, 'sduiid=' + encodeURIComponent(componentId));
  const body = entry.postData.replaceAll(originalSlug, slug);
  headers['referer'] = `https://www.linkedin.com/in/${slug}/`;

  const res = await fetch(url, { method: 'POST', headers, body, signal });
  return { status: res.status, text: await res.text() };
}

// --- full-page details fetch, single shot (Experience) ---
async function fetchDetailsPage(slug, sectionName, signal) {
  const entry = templates.detailsPageTemplates[sectionName];
  if (!entry) return null;
  const originalSlug = entry.url.match(/\/in\/([^/]+)\/details\//)[1];
  const headers = stripHopHeaders(entry.headers);
  const url = entry.url.replaceAll(originalSlug, slug);
  const body = entry.postData.replaceAll(originalSlug, slug);
  const res = await fetch(url, { method: 'POST', headers, body, signal });
  return { status: res.status, text: await res.text() };
}

// Pure per-page decision logic, pulled out of the fetch loop below so it's
// unit-testable without a live LinkedIn session: given one page's raw
// (pre-clean) extracted lines, decide what items it contains and whether
// pagination should stop after it. This is where the off-by-one bug lived
// (see the hr-path comment) -- kept as its own function specifically so
// that regression has a direct test, not just an end-to-end one.
function parsePaginatedPage(rawPageLines, count) {
  if (rawPageLines.length === 0) return { items: [], stop: true };

  const clean = cleanStrings(rawPageLines);
  const hasEndorseMarker = clean.some((l) => l === 'Endorse' || l.startsWith('Endorse '));

  if (hasEndorseMarker) {
    // Skills: group into {name, context} per item, count real items
    const items = [];
    let chunk = [];
    for (const line of clean) {
      if (line === 'Endorse' || line.startsWith('Endorse ')) {
        if (chunk.length) {
          items.push({ name: chunk[0], context: chunk.slice(1) });
          chunk = [];
        }
      } else {
        chunk.push(line);
      }
    }
    return { items, stop: items.length < count };
  }

  const hrCount = rawPageLines.filter((l) => l === 'hr').length;
  if (hrCount > 0) {
    // Education/Certifications: "hr" delimits each item, but only
    // BETWEEN items -- the first entry on a page has no leading divider,
    // so a genuinely full page of `count` items produces `count - 1` "hr"
    // markers, not `count`. Comparing hrCount directly against count
    // under-counts by one and stops pagination a page early (real bug,
    // caught by comparing against a manually-counted profile: 12 real
    // certifications, only 10 returned). Keep the RAW lines (not
    // cleaned) so lib/parsers.js can group by that divider downstream --
    // tagged so the caller can tell this apart from the {name,context}
    // skills shape.
    return { items: [{ __rawPage: rawPageLines }], stop: (hrCount + 1) < count };
  }

  // Self-view (own profile, edit-mode UI) has NEITHER an "Endorse" marker
  // NOR an "hr" divider on Skills pages -- flat list of names with no
  // clean per-item boundary at all (documented, accepted limitation, see
  // README -- self-view isn't the product's primary use case). Fall back
  // to one item per cleaned line rather than losing the data entirely.
  return {
    items: clean.map((line) => ({ name: line, context: [] })),
    stop: clean.length < 8,
  };
}

// --- paginated fetch loop (Skills, Certifications, Education) ---
async function fetchPaginated(slug, sectionName, signal) {
  const entry = templates.paginationTemplates[sectionName];
  if (!entry) return [];
  const headers = stripHopHeaders(entry.headers);
  const bodyTemplate = JSON.parse(entry.postData);
  const originalSlug = bodyTemplate.clientArguments.payload.vanityName;

  const allLines = [];
  const count = 10;
  for (let start = 0; start < 300; start += count) {
    const body = JSON.parse(JSON.stringify(bodyTemplate));
    body.clientArguments.payload.vanityName = slug;
    body.clientArguments.payload.start = start;
    body.clientArguments.payload.count = count;
    // headers may reference the original slug in referer -- swap it
    const pageHeaders = { ...headers };
    if (pageHeaders.referer) pageHeaders.referer = pageHeaders.referer.replaceAll(originalSlug, slug);

    const res = await fetch(entry.url, { method: 'POST', headers: pageHeaders, body: JSON.stringify(body), signal });
    const text = await res.text();
    const index = parseFlightStream(text);
    const resolved = resolveAll(index);
    const rawPageLines = extractStrings(resolved['0']); // NOT cleaned yet -- "hr"
    // dividers (Education/Certifications) and "Endorse" markers (Skills)
    // are per-item delimiters that cleanStrings() would otherwise strip
    // as noise before they can be used as boundaries.
    const { items, stop } = parsePaginatedPage(rawPageLines, count);
    allLines.push(...items);
    if (stop) break;
    await new Promise((r) => setTimeout(r, 400)); // small pacing delay
  }
  return allLines;
}

// --- top card: plain GET, no Flight resolution needed, server-rendered ---
// Thrown for conditions the caller (src/services/profileService.js) should
// map to a specific HTTP status rather than a generic 500 -- kept as plain
// Error + .code here (not a custom class) so lib/ stays independent of the
// Express layer, importable/testable on its own.
function libError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

async function fetchTopCard(slug, signal) {
  const entry = templates.componentTemplate;
  const headers = stripHopHeaders(entry.headers);
  delete headers['content-type']; delete headers['origin'];
  const res = await fetch(`https://www.linkedin.com/in/${slug}/`, {
    method: 'GET',
    headers: { cookie: headers.cookie, 'user-agent': headers['user-agent'], accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal,
  });
  const finalUrl = res.url || '';
  const html = await res.text();

  // Session dead: LinkedIn redirects an unauthenticated/expired-session
  // request to the login/checkpoint/authwall flow instead of serving the
  // profile. Check this BEFORE parsing -- a login page has no profile
  // content to extract, so silently returning null fields would hide a
  // real, actionable problem (stale li_at cookie) behind what looks like
  // "this profile just has no data."
  if (/\/(login|checkpoint|authwall)(\/|$|\?)/i.test(finalUrl)) {
    throw libError('SESSION_EXPIRED', 'LinkedIn redirected to login/checkpoint -- session cookie is dead.');
  }
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  if (titleMatch && /sign in|log in/i.test(titleMatch[1])) {
    throw libError('SESSION_EXPIRED', 'LinkedIn served a sign-in page -- session cookie is dead.');
  }

  const topCard = parseTopCard(html);

  // Best-effort profile-not-found signal: no name was extractable at all
  // AND the title didn't resolve to a person's name (LinkedIn's generic
  // "member profile unavailable" page looks like this). Not exhaustively
  // tested against every possible not-found variant -- documented as a
  // best-effort heuristic, not a guarantee, in README known limitations.
  if (!topCard.name && !titleMatch) {
    throw libError('PROFILE_NOT_FOUND', `No profile content found for slug "${slug}".`);
  }

  return topCard;
}

function parseTopCard(html) {
  const $ = cheerio.load(html);
  const junkHeadings = /notification|jump menu/i;
  const headings = [];
  $('h1, h2').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length < 80 && !junkHeadings.test(text)) headings.push(text);
  });
  const name = headings[0] || null;
  const result = { name, headline: null, location: null, profileImage: null };

  if (name) {
    const closeTag = `>${name}</h2>`;
    const idx = html.indexOf(closeTag);
    if (idx !== -1) {
      const after = html.slice(idx + closeTag.length);
      const contactIdx = after.indexOf('Contact info');
      const slice = contactIdx !== -1 ? after.slice(0, contactIdx) : after.slice(0, 3000);
      const $$ = cheerio.load(`<div>${slice}</div>`);
      const lines = [];
      $$('*').contents().each((_, node) => {
        if (node.type === 'text') {
          const t = $$(node).text().trim();
          if (t && t.length > 1) lines.push(t);
        }
      });
      const junkLine = /^(He\/Him|She\/Her|They\/Them|Verify in|Contact info|·\s*(1st|2nd|3rd)$)/i;
      const clean = lines.filter((l) => !junkLine.test(l));
      result.headline = clean[0] || null;
      result.location = clean.find((l) => /^[\w\s.'-]+,\s*[\w\s.'-]+$/.test(l)) || clean[clean.length - 1] || null;
    }

    // Primary: the <link rel="preload"> image hint near the top of <head>.
    // The topcard's own dedicated photo slot always renders an SVG
    // placeholder in raw server-rendered HTML (even for profiles with a
    // real photo -- confirmed on a known-good profile), so that slot is
    // useless as an anchor. The preload hint is reliably present and,
    // verified against a real profile fetched by a DIFFERENT logged-in
    // viewer, correctly reflects the PAGE OWNER's photo, not the
    // viewer's own nav avatar.
    const preloadMatch = html.match(/imageSrcSet="([^"]*profile-displayphoto-(?:shrink|scale|crop)_\d+_\d+[^"]*)"/);
    if (preloadMatch) {
      const srcSet = preloadMatch[1];
      const candidates = [...srcSet.matchAll(/(https:\/\/media\.licdn\.com\/dms\/image\/[^\s,]+profile-displayphoto-(?:shrink|scale|crop)_(\d+)_\d+[^\s,]*)\s+\d+w/g)]
        .map((m) => ({ url: m[1], size: Number(m[2]) }));
      if (candidates.length) {
        candidates.sort((a, b) => b.size - a.size);
        result.profileImage = candidates[0].url.replace(/&amp;/g, '&');
      }
    }

    // Fallback: alt="View <Name>'s profile" tagged <img> elsewhere on the
    // page (hover cards, recommendation widgets). Name-scoped so it can't
    // grab someone else's photo, but not guaranteed present on every
    // fetch since it depends on which dynamic widgets happen to render.
    if (!result.profileImage) {
      const nameNoNickname = name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
      const htmlEncode = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const nameVariants = [...new Set([name, nameNoNickname])].map(htmlEncode);
      const imgTags = html.match(/<img\b[^>]*>/g) || [];
      const candidates = [];
      for (const tag of imgTags) {
        const altOk = nameVariants.some((n) => new RegExp(`alt="View ${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[’']s profile"`).test(tag));
        if (!altOk) continue;
        const srcMatch = tag.match(/src="(https:\/\/media\.licdn\.com\/dms\/image\/[^"]*profile-displayphoto-(?:shrink|scale|crop)_(\d+)_\d+[^"]*)"/);
        if (srcMatch) candidates.push({ url: srcMatch[1], size: Number(srcMatch[2]) });
      }
      if (candidates.length) {
        candidates.sort((a, b) => b.size - a.size);
        result.profileImage = candidates[0].url.replace(/&amp;/g, '&');
      }
    }
  }
  return result;
}

// --- main orchestrator ---
// `signal` (an AbortSignal) is optional -- lib/ stays usable standalone
// (CLI, tests) without one. When the caller (profileService.js) passes
// one tied to its request timeout, every fetch() below aborts for real
// instead of the timeout only giving up on waiting for them (see
// profileService.js's comment on why that distinction matters).
async function fetchProfile(profileUrl, { signal } = {}) {
  const slug = profileUrl.match(/\/in\/([^/?]+)/)?.[1];
  if (!slug) throw new Error('Invalid LinkedIn profile URL');

  const topCard = await fetchTopCard(slug, signal);

  const [aboveActivityRes, experienceRes, part1Res, skillsPreviewRes, languagesRes] = await Promise.all([
    fetchComponent(slug, COMPONENT_IDS.aboveActivity, signal),
    fetchComponent(slug, COMPONENT_IDS.experience, signal),
    fetchComponent(slug, COMPONENT_IDS.part1, signal),
    fetchComponent(slug, COMPONENT_IDS.skills, signal),
    fetchComponent(slug, COMPONENT_IDS.languages, signal),
  ]);

  const about = extractAbout(aboveActivityRes.text);

  // Experience: try the full details page first (single-shot, no
  // pagination needed -- confirmed it returns the complete list),
  // fall back to the preview if that fails for any reason. Use RAW
  // (pre-clean) lines so parseExperienceSection can group by the "hr"
  // per-company divider before it gets stripped as noise.
  let experienceRaw;
  const expDetails = await fetchDetailsPage(slug, 'experience', signal);
  if (expDetails && expDetails.status === 200) {
    experienceRaw = extractSectionsFromResponse(expDetails.text).rawSections.experienceDetailSection;
  }
  if (!experienceRaw) {
    experienceRaw = extractSectionsFromResponse(experienceRes.text).rawSections.experienceTopLevelSection || [];
  }
  const experience = parseExperienceSection(experienceRaw);

  const part1Extracted = extractSectionsFromResponse(part1Res.text);
  const educationPreview = part1Extracted.sections.educationTopLevelSection || null;
  const certificationsPreview = part1Extracted.sections.certificationTopLevelSection || null;
  const projects = part1Extracted.sections.projectsSection || null;

  const skillsPreview = extractSectionsFromResponse(skillsPreviewRes.text).sections.skillsSection || [];
  const languages = extractLanguages(languagesRes.text);

  // Full lists via pagination, only when a "Show all" truncation marker is
  // present (avoids an unnecessary extra round-trip when the preview is
  // already complete). Search the WHOLE raw response text, not just the
  // section-scoped extraction -- confirmed on real data that this marker
  // can land as a SIBLING of the section node rather than a child of it
  // (inconsistent between profiles/requests), so a section-scoped search
  // can miss it entirely. Under-triggering here (missing real data) is a
  // much worse failure than an occasional unnecessary extra fetch.
  const needsFullSkills = skillsPreview.length > 0; // main-page skills preview is ALWAYS incomplete (category-bucket widget)
  const needsFullEducation = /Show all \d+ educations?/i.test(part1Res.text);
  const needsFullCerts = /Show all \d+ licenses?/i.test(part1Res.text);

  const [fullSkills, fullEducationPages, fullCertificationPages] = await Promise.all([
    needsFullSkills ? fetchPaginated(slug, 'skills', signal) : Promise.resolve(null),
    needsFullEducation ? fetchPaginated(slug, 'education', signal) : Promise.resolve(null),
    needsFullCerts ? fetchPaginated(slug, 'certifications', signal) : Promise.resolve(null),
  ]);

  const education = fullEducationPages
    ? parseEducationSection(flattenRawPages(fullEducationPages))
    : parseEducationSection(part1Extracted.rawSections.educationTopLevelSection || []);
  const certifications = fullCertificationPages
    ? parseCertificationSection(flattenRawPages(fullCertificationPages))
    : parseCertificationSection(part1Extracted.rawSections.certificationTopLevelSection || []);

  return {
    ...topCard,
    about,
    experience,
    education,
    certifications,
    // fullSkills is either already {name,context} objects (public-view,
    // "Endorse"-delimited) or, for self-view profiles, an array of
    // {__rawPage} tagged raw lines (hr-delimited, no Endorse marker) that
    // still needs grouping -- detect which shape came back and finish
    // the self-view case here rather than leaving it half-parsed.
    skills: fullSkills
      ? (fullSkills[0] && fullSkills[0].__rawPage
          ? parseSkillsSelfView(flattenRawPages(fullSkills))
          : fullSkills)
      : skillsPreview,
    languages,
    projects,
  };
}

// fetchPaginated() tags each raw page as {__rawPage: [...]} for the
// Education/Certifications path (see its comments) -- flatten those back
// into one combined raw line array for the parsers to group by "hr".
function flattenRawPages(taggedPages) {
  const lines = [];
  for (const page of taggedPages) {
    if (page && page.__rawPage) lines.push(...page.__rawPage);
  }
  return lines;
}

// Languages: drops the "Languages" heading, pairs up the remaining lines
// (LinkedIn renders each language as [Name, ProficiencyLevel]).
function extractLanguages(rawLanguagesText) {
  const cleaned = extractSectionsFromResponse(rawLanguagesText).sections.languageTopLevelSection || [];
  const withoutHeading = cleaned.filter((l) => l !== 'Languages');
  const languages = [];
  for (let i = 0; i < withoutHeading.length; i += 2) {
    if (withoutHeading[i + 1]) languages.push({ name: withoutHeading[i], proficiency: withoutHeading[i + 1] });
  }
  return languages;
}

// About: cut the raw lines at the FIRST heading-like boundary after the
// real paragraph text -- the About card shares its container with the
// "Top skills" mini-widget (verified: both live under the same node), so
// without a cutoff the about[] array ends up mixing unrelated content in.
// Also drops the literal "About" heading itself, which isn't part of the
// bio text.
function extractAbout(rawAboveActivityText) {
  const { rawSections } = extractSectionsFromResponse(rawAboveActivityText);
  const raw = rawSections.aboutSection;
  if (!raw) return null;
  const cleaned = cleanStrings(raw);
  const aboutIdx = cleaned.indexOf('About');
  if (aboutIdx === -1) return cleaned.length ? cleaned : null;
  const stopWords = ['Top skills', 'Show top skills', 'Featured', 'Analytics'];
  let endIdx = cleaned.length;
  for (const w of stopWords) {
    const idx = cleaned.indexOf(w, aboutIdx + 1);
    if (idx !== -1 && idx < endIdx) endIdx = idx;
  }
  const paragraphLines = cleaned.slice(aboutIdx + 1, endIdx);
  return paragraphLines.length ? paragraphLines.join(' ') : null;
}

if (require.main === module) {
  // Only load .env when run directly as a CLI (e.g. for manual testing).
  // When required as a module (src/services/profileService.js), the
  // caller (server.js / api/index.js) is responsible for loading env --
  // lib/ stays framework-agnostic, doesn't assume dotenv is even present.
  require('dotenv').config({ quiet: true }); // quiet: the startup banner pollutes stdout JSON output
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node fetch-profile.js <linkedin-profile-url>');
    process.exit(1);
  }
  fetchProfile(url)
    .then((data) => {
      console.log(JSON.stringify(data, null, 2));
    })
    .catch((e) => {
      console.error('ERROR:', e.message);
      process.exit(1);
    });
}

module.exports = { fetchProfile, parsePaginatedPage, extractAbout, extractLanguages, parseTopCard };
