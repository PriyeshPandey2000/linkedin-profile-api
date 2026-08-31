// Turns a raw Flight-protocol response (already resolved via
// flight-resolver.js) into clean structured section data. Same spirit as
// extract.js's DOM approach -- find each section via a stable anchor
// (observabilityIdentifier, same trick used there), then filter out
// structural noise that's mixed in throughout (hashed classNames, style
// prop values, HTML tag names, tracking ids) rather than just at
// boundaries, since chunk-based text is noisier than rendered DOM text.

const { parseFlightStream, resolveAll, extractStrings } = require('./flight-resolver');

// --- noise filters, built empirically against real captured responses ---
const HTML_TAGS = new Set([
  'div', 'span', 'section', 'article', 'aside', 'header', 'footer', 'nav',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'svg', 'path', 'button',
  'a', 'ul', 'li', 'img', 'figure', 'figcaption', 'label', 'input', 'form',
]);

const STYLE_PROP_VALUES = new Set([
  'underline', 'start', 'end', 'center', 'default', 'normal', 'bold',
  'sans', 'small', 'medium', 'large', 'xlarge', 'horizontal', 'vertical',
  'block', 'flexStart', 'flexEnd', 'flex-start', 'flex-end', 'italic',
  'contents', 'hidden', 'visible', 'auto', 'none', 'inherit', 'true',
  'false', 'left', 'right', 'top', 'bottom', 'row', 'column', 'wrap',
  'nowrap', 'solid', 'dashed', 'dotted', 'cover', 'contain', 'stretch',
  'inline', 'flex', 'grid', 'absolute', 'relative', 'fixed', 'static',
]);

// confirmed-junk short technical words, seen repeatedly across multiple
// sections as structural/tracking artifacts, never as real profile
// content
const JUNK_WORDS = new Set([
  'click', 'screen', 'modal', 'media', 'position', 'flexstart',
  'icondisabled', 'isolate', 'open', 'presentation', 'rounded', 'id',
  'stringvalue', 'expanded', 'more', 'url', 'list', 'listitem', 'text',
  'linkhover', 'linkactive', 'endorse_skill', 'loading', 'fitcontent',
  'secondary', 'expression', 'notexpression', 'hr', 'bindableboolean',
  'booleanbinding', 'booleanvalue', 'icon', 'ghost', 'edit', 'edit_skills',
  'edit_education', 'add_education', 'add_skills', 'outline', 'toplevel',
  'detail', 'reorder education', 'add education', 'inlineblock',
  'lazycolumn', 'andexpression', 'currentscreen', 'bindablestring',
  'stringbinding', 'back', 'fullpage', 'floatexpression', 'screenid',
  'floatvalue', 'embeddedwebview', 'google.protobuf.empty', 'backgroundfaint',
  'iconknockout', 'fillavailable',
]);

// lowercase internal type-discriminator tags -- exact-case match only, so
// this does NOT also filter the real capitalized section headings
// ("Education" the heading stays, "education" the internal tag goes)
const TYPE_TAG_WORDS = new Set(['education', 'certifications', 'projects', 'project_media']);

function isNoise(s) {
  if (s.length < 2) return true; // single chars (react array-index keys)
  if (JUNK_WORDS.has(s.toLowerCase())) return true;
  if (TYPE_TAG_WORDS.has(s)) return true;
  if (s.startsWith('{0,plural,')) return true; // raw ICU pluralization format string
  if (s.startsWith('Thumbnail for ')) return true;
  if (s.startsWith('https://www.linkedin.com/safety/go/')) return true; // tracking-wrapped external link
  if (/^\d+$/.test(s)) return true; // pure numeric index keys
  if (HTML_TAGS.has(s)) return true;
  if (STYLE_PROP_VALUES.has(s.toLowerCase())) return true;
  // hashed classNames: space-separated tokens like "_5d302b6a a6bc4c2c ..."
  // -- MUST require a digit in each token, otherwise this matches plain
  // English word pairs too (e.g. "Engineering Leadership" is two 6-12
  // letter alphabetic tokens and would false-positive without this)
  if (/^([a-z0-9_]*[0-9][a-z0-9_]*)( [a-z0-9_]*[0-9][a-z0-9_]*){1,}$/i.test(s) && s.length <= 200) return true;
  // single hashed token on its own
  if (/^_?[a-f0-9]{6,10}$/i.test(s)) return true;
  // base64 / base64url-ish tracking ids and urns (LinkedIn mixes standard
  // and url-safe variants -- some contain _ or - instead of + and /)
  if (/^[A-Za-z0-9+/_-]{16,}={0,2}$/.test(s)) return true;
  // CDN media URLs -- not needed for any required field, and each
  // media-attached experience entry drags in 5-6 resolution variants.
  // Some are split across two separate string values (base path +
  // resolution/hash/query fragment), so match either half independently.
  if (s.includes('media.licdn.com') || s.includes('company-logo') || s.includes('profile-treasury-image')) return true;
  if (s.includes('v=beta&t=') || /^\d+_\d+\/[A-Za-z0-9._-]+\//.test(s)) return true;
  // CSS custom-property references
  if (/^var\(--[a-f0-9]+\)$/i.test(s)) return true;
  // CSS transform value with an embedded custom-property offset, e.g.
  // "translate(0px, var(--46d8fc60))" -- a lazy-load anchor's inline
  // style. Left unfiltered, its embedded comma gets mistaken for the
  // degree/field separator by parseEducationGroup's positional split.
  if (/^translate\(-?\d+(\.\d+)?px,\s*var\(--[a-f0-9]+\)\)$/i.test(s)) return true;
  // internal relative link paths (overlay/detail deep-links) -- not
  // needed content, just navigation targets
  if (/^\/in\//.test(s)) return true;
  // icon/spacing size tokens: "10.8rem", "7x", "1x"
  if (/^\d+(\.\d+)?(rem|px|x)$/.test(s)) return true;
  // media alt-text placeholders: "Thumbnail for 3"
  if (/^Thumbnail for \d+$/.test(s)) return true;
  // componentKey / internal identifiers
  if (s.startsWith('com.linkedin.sdui.') || s.startsWith('com.linkedin.voyager.') || s.startsWith('proto.sdui.')) return true;
  if (s.startsWith('urn:li:')) return true;
  if (/^auto-component-[0-9a-f-]+$/i.test(s)) return true;
  if (s.startsWith('expandable_text_block_auto-component')) return true;
  if (s.startsWith('profileEndorseSkillButtonLoading')) return true;
  // raw stringified JSON blobs embedded as values (never real content)
  if (s.startsWith('{') && s.endsWith('}')) return true;
  // app version strings like "0.1.50808"
  if (/^\d+\.\d+\.\d+$/.test(s)) return true;
  // self-view edit-mode chrome: "Edit <name> skill", "Edit education
  // <name>", "Navigate back to profile main screen" etc -- these carry
  // the real name too, but as a WHOLE-LINE match they're noise; the
  // caller can regex out the name separately where useful (see
  // fetch-profile.js's skills grouping)
  if (/^Edit .+ skill$/.test(s)) return true;
  if (/^Edit education .+$/.test(s) || /^Edit .+ education$/i.test(s)) return true;
  if (s === 'edit_about' || s === 'Edit about' || s === 'edit_education' || s === 'edit') return true;
  if (s.startsWith('Navigate back to')) return true;
  if (s.startsWith('When you add new') || s.startsWith('Showcase your') || s.startsWith('Nothing to see')) return true;
  if (s === 'low' || s === 'xMidYMid slice') return true; // SVG/image loading-priority attrs
  if (/^Show all \d+ details/.test(s)) return true; // per-item "show more skill tags" chrome
  if (s === 'Add skills' || s === 'Add skill') return true;
  // UUIDs
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
  // technical enum-style constants: SHORT_PRESS, PresentationStyle_MODAL,
  // ColorScheme_UNKNOWN, ModalSize_LARGE -- has an underscore directly
  // adjacent to an all-caps segment, never true in natural sentences
  // requires an underscore-separated caps group -- standalone acronyms
  // like "SQL", "CSS", "AWS" must NOT match (they're common real content),
  // only things shaped like SHORT_PRESS / ColorScheme_UNKNOWN
  if (/[a-zA-Z]_[A-Z]{2,}\b/.test(s) || /^[A-Z]{2,}(_[A-Z]{2,})+$/.test(s)) return true;
  // kebab/snake technical identifiers: 3+ segments joined by - or _, no
  // spaces -- natural language uses spaces, not hyphens/underscores
  if (/^[a-z0-9]+([_-][a-z0-9]+){2,}$/.test(s)) return true;
  // CSS custom-property refs with an underscore-prefixed hash --
  // "var(--_4c78be03)" doesn't match the plain a-f0-9 pattern above
  if (/^var\(--_?[a-f0-9]+\)$/i.test(s)) return true;
  if (s === 'strong') return true; // HTML tag, missed from the original HTML_TAGS set
  if (s === 'Skills:') return true; // label, the actual skill list is the next line
  // company/school reference URLs -- logo link targets, not content
  if (/^https:\/\/www\.linkedin\.com\/(company|school)\/\d+\/?$/.test(s)) return true;
  // empty-state hint text: "<Name> that <X> adds will appear here."
  if (/adds will appear here\.?$/i.test(s) || s.includes('will appear here')) return true;
  return false;
}

function cleanStrings(strings) {
  const out = [];
  for (const s of strings) {
    if (isNoise(s)) continue;
    if (out.length && out[out.length - 1] === s) continue; // dedupe consecutive
    out.push(s);
  }
  return out;
}

// Find every NODE that carries an observabilityIdentifier (LinkedIn's own
// internal analytics tag), same anchor we used to map DOM containers to
// section names. Returns { [sectionName]: node } -- the actual matched
// node object, NOT the top-level chunk id it happens to live inside.
// Sections are often nested siblings bundled under one shared parent
// chunk (e.g. About + Highlights + Featured all inside one container), so
// scoping to the chunk id would mix them together -- scoping to the
// specific node (and its .children only, skipping tracking-id metadata
// fields on the node itself) keeps each section isolated.
function findSections(resolved) {
  const sections = {};
  const visited = new Set();
  function walk(node) {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node && typeof node === 'object' && !node.__import) {
      if (visited.has(node)) return; // avoid re-walking shared references
      visited.add(node);
      if (typeof node.observabilityIdentifier === 'string') {
        const name = node.observabilityIdentifier.split('.').pop();
        if (!(name in sections)) sections[name] = node;
      }
      for (const v of Object.values(node)) walk(v);
    }
  }
  for (const val of Object.values(resolved)) walk(val);
  return sections;
}

function extractSectionsFromResponse(rawText) {
  const index = parseFlightStream(rawText);
  const resolved = resolveAll(index);
  const sectionMap = findSections(resolved);

  const sections = {};
  const rawSections = {};
  for (const [name, node] of Object.entries(sectionMap)) {
    const scope = node.children !== undefined ? node.children : node;
    const raw = extractStrings(scope);
    rawSections[name] = raw; // pre-clean -- callers that need structural
                              // dividers (e.g. "hr" between entries, which
                              // cleanStrings would otherwise strip as noise
                              // before it can be used as a boundary) read
                              // from here instead
    sections[name] = cleanStrings(raw);
  }
  return { sectionMap: Object.keys(sectionMap), sections, rawSections, resolved };
}

// Splits a RAW (pre-clean) line array into groups at each occurrence of a
// divider token, cleaning each group independently. LinkedIn separates
// each company/entry in Experience/Education/Certifications with a
// literal "hr" line (confirmed empirically: 6 "hr" markers on a profile
// with exactly 6 distinct companies) -- this is the boundary a per-entry
// parser needs, but it only survives in the RAW stream since "hr" is
// itself filtered as noise once cleaned.
function groupByDivider(rawLines, dividerToken = 'hr') {
  const groups = [];
  let current = [];
  for (const line of rawLines) {
    if (line === dividerToken) {
      if (current.length) groups.push(cleanStrings(current));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) groups.push(cleanStrings(current));
  return groups.filter((g) => g.length > 0);
}

module.exports = { extractSectionsFromResponse, groupByDivider, cleanStrings, isNoise };
