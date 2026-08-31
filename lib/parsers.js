// Domain-specific structuring: turns the cleaned-but-flat line arrays from
// flight-extract.js into typed objects per entry (one job, one degree, one
// certification -- not a a flat soup of strings). Kept separate from
// flight-extract.js, which is generic Flight-response noise filtering with
// no knowledge of what an "experience entry" is.
//
// Approach: LinkedIn separates each company/entry with a literal "hr" line
// in the raw (pre-clean) stream (verified empirically: a profile with
// exactly 6 distinct companies produced exactly 6 "hr" markers). Field
// values inside each group are extracted by REGEX PATTERN, not fixed
// array position -- position was tested and found to vary between entries
// (e.g. "Company · EmploymentType" vs "EmploymentType · duration" ordering
// flips depending on the entry), so a positional parser would silently
// misparse a meaningful fraction of real profiles.

const { groupByDivider } = require('./flight-extract');

const DATE_RANGE_RE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\s*[-–]\s*(Present|[A-Za-z]+\s+\d{4})/;
const DURATION_ONLY_RE = /\d+\s*(yr|yrs|mo|mos)\b/i;
const WORKTYPE_RE = /(Remote|Hybrid|On-site)$/;
const EMPLOYMENT_TYPES = [
  'Full-time', 'Part-time', 'Self-employed', 'Freelance', 'Contract',
  'Internship', 'Apprenticeship', 'Seasonal', 'Co-op',
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Parses ONE company/entry group, assuming it represents a single role.
// Field-by-field pattern matching, not positional -- see module comment.
function parseSingleRoleEntry(lines) {
  const consumed = new Set();
  const entry = {
    title: null, company: null, employmentType: null,
    dates: null, location: null, description: [], skills: null,
  };

  lines.forEach((line, i) => {
    const m = line.match(/^(.*) logo$/);
    if (m) { entry.company = m[1]; consumed.add(i); }
  });
  lines.forEach((line, i) => {
    if (consumed.has(i)) return;
    if (/^Skills for /.test(line)) { consumed.add(i); return; }
    if (entry.company && line === entry.company) consumed.add(i);
  });
  lines.forEach((line, i) => {
    if (consumed.has(i)) return;
    if (DATE_RANGE_RE.test(line)) { if (!entry.dates) entry.dates = line; consumed.add(i); }
  });
  lines.forEach((line, i) => {
    if (consumed.has(i)) return;
    if (line.includes('·') && WORKTYPE_RE.test(line)) { if (!entry.location) entry.location = line; consumed.add(i); }
  });
  lines.forEach((line, i) => {
    if (consumed.has(i)) return;
    for (const type of EMPLOYMENT_TYPES) {
      if (line.endsWith('· ' + type)) {
        entry.employmentType = type;
        if (line.includes('·') && !entry.company) entry.company = line.split('·')[0].trim();
        consumed.add(i);
        break;
      }
      if (line.startsWith(type + ' ·')) {
        entry.employmentType = type;
        if (!entry.dates) entry.dates = line;
        consumed.add(i);
        break;
      }
    }
  });
  lines.forEach((line, i) => {
    if (consumed.has(i)) return;
    if (DURATION_ONLY_RE.test(line) && line.length < 30) { if (!entry.dates) entry.dates = line; consumed.add(i); }
  });
  lines.forEach((line, i) => {
    if (consumed.has(i)) return;
    if (/and \+\d+ skills?$/.test(line) || (/,/.test(line) && /skills?$/i.test(line))) {
      if (!entry.skills) entry.skills = line;
      consumed.add(i);
    }
  });
  lines.forEach((line, i) => {
    if (consumed.has(i)) return;
    if (entry.company && new RegExp(` at ${escapeRegex(entry.company)}$`).test(line)) consumed.add(i);
  });

  let remaining = lines.filter((l, i) => !consumed.has(i) && !/^[a-z0-9-]+$/.test(l));
  const titleIdx = remaining.findIndex((l) => l.length < 80 && !/[.!]$/.test(l));
  if (titleIdx !== -1) {
    entry.title = remaining[titleIdx];
    remaining.splice(titleIdx, 1);
  }
  remaining = remaining.filter((l) => l !== entry.title);
  entry.description = remaining.filter(Boolean);
  return entry;
}

// Multiple roles at the same company render inside ONE "hr" group with no
// clean sub-divider (tested: a title-immediately-followed-by-a-date/
// employment-type heuristic over-splits on real data -- a bare
// employment-type line like "Co-op" or a trailing location line gets
// mistaken for its own role). Rather than ship confidently-wrong sub-
// entries, detect the multi-role case (more than one date-range line in
// the group) and degrade honestly: keep it as one entry with the company
// name correct, all real text preserved in `description`, and a flag so
// callers/consumers know it wasn't fully split -- instead of pretending a
// fragile heuristic produced clean per-role data.
function parseExperienceGroup(lines) {
  // count DISTINCT date-range values, not raw occurrences -- LinkedIn
  // duplicates a single role's date line for accessibility (seen twice in
  // the raw stream), which would otherwise look like 2 different roles
  const distinctDateValues = new Set(lines.filter((l) => DATE_RANGE_RE.test(l)));
  if (distinctDateValues.size <= 1) return parseSingleRoleEntry(lines);

  const logoLine = lines.find((l) => / logo$/.test(l));
  const company = logoLine ? logoLine.replace(/ logo$/, '') : null;
  const cleaned = lines.filter((l) => {
    if (/ logo$/.test(l)) return false;
    if (/^Skills for /.test(l)) return false;
    if (company && new RegExp(` at ${escapeRegex(company)}$`).test(l)) return false;
    if (company && l === company) return false;
    return true;
  });

  return {
    company,
    multipleRoles: true, // signals: not fully parsed into per-role objects, see README known limitations
    title: null, employmentType: null, dates: null, location: null, skills: null,
    description: cleaned,
  };
}

function parseExperienceSection(rawLines) {
  const groups = groupByDivider(rawLines);
  return groups
    .map(parseExperienceGroup)
    // drop groups that aren't real entries (leading page chrome before
    // the first "hr", trailing "Show all experiences" footer after the
    // last) -- a real entry always has a company name AND at least one
    // of title/dates/skills; page chrome never has a company at all
    .filter((e) => e.company && (e.title || e.dates || e.skills || (e.description && e.description.length)));
}

// Education and Certifications are structurally simpler than Experience
// (no employment-type/worktype variants, rarely multi-entry-per-group) --
// same "hr" grouping, lighter field extraction per group.

function parseEducationGroup(lines) {
  const consumed = new Set();
  const entry = { school: null, degree: null, field: null, dates: null, grade: null };

  lines.forEach((line, i) => {
    const m = line.match(/^(.*) logo$/);
    if (m) { entry.school = m[1]; consumed.add(i); }
  });
  lines.forEach((line, i) => {
    if (consumed.has(i)) return;
    if (/^Skills for /.test(line)) { consumed.add(i); return; }
    if (entry.school && line === entry.school) consumed.add(i);
  });
  lines.forEach((line, i) => {
    if (consumed.has(i)) return;
    const m = line.match(/^Grade:\s*(.+)$/i);
    if (m) { entry.grade = m[1]; consumed.add(i); }
  });
  lines.forEach((line, i) => {
    if (consumed.has(i)) return;
    if (/\d{4}\s*[-–]\s*\d{4}/.test(line) || /^[A-Za-z]+ \d{4}\s*[-–]\s*[A-Za-z]+ \d{4}$/.test(line)) {
      if (!entry.dates) entry.dates = line;
      consumed.add(i);
    }
  });
  lines.forEach((line, i) => {
    if (consumed.has(i)) return;
    if (/,/.test(line) && /skills?$/i.test(line)) consumed.add(i); // skills-for-course summary, not a required field
  });
  lines.forEach((line, i) => {
    if (consumed.has(i)) return;
    if (entry.school && new RegExp(` at ${escapeRegex(entry.school)}$`).test(line)) consumed.add(i);
  });

  const remaining = lines.filter((l, i) => !consumed.has(i) && !/^[a-z0-9-]+$/.test(l));
  // first remaining line = degree (may include field after a comma: "Bachelor of
  // Technology - BTech, Information Technology")
  if (remaining.length) {
    const [degreePart, ...fieldParts] = remaining[0].split(',');
    entry.degree = degreePart.trim();
    if (fieldParts.length) entry.field = fieldParts.join(',').trim();
  }
  return entry;
}

function parseEducationSection(rawLines) {
  const groups = groupByDivider(rawLines);
  return groups
    .map(parseEducationGroup)
    // a real entry always has a school (from the "X logo" line); page
    // chrome before the first "hr" never does
    .filter((e) => e.school);
}

function parseCertificationGroup(lines) {
  const consumed = new Set();
  const entry = { name: null, issuer: null, issuedDate: null, credentialId: null };

  lines.forEach((line, i) => {
    const m = line.match(/^(.*) logo$/);
    if (m) { entry.issuer = m[1]; consumed.add(i); }
  });
  lines.forEach((line, i) => {
    if (consumed.has(i)) return;
    const m = line.match(/^Issued\s+(.+)$/i);
    if (m) { entry.issuedDate = m[1]; consumed.add(i); }
  });
  lines.forEach((line, i) => {
    if (consumed.has(i)) return;
    const m = line.match(/^Credential ID\s+(.+)$/i);
    if (m) { entry.credentialId = m[1]; consumed.add(i); }
  });
  lines.forEach((line, i) => {
    if (consumed.has(i)) return;
    if (/^Show credential/i.test(line)) consumed.add(i);
    if (/^Skills for /i.test(line)) consumed.add(i);
    if (/,/.test(line) && /skills?$/i.test(line)) consumed.add(i); // associated-skills summary, not required
  });

  const remaining = lines.filter((l, i) => !consumed.has(i) && !/^[a-z0-9-]+$/.test(l));
  if (remaining.length) entry.name = remaining[0];
  if (!entry.issuer && remaining.length > 1) entry.issuer = remaining[1];
  return entry;
}

function parseCertificationSection(rawLines) {
  const groups = groupByDivider(rawLines);
  return groups
    .map(parseCertificationGroup)
    // a real entry always has an issuedDate or a credentialId. `issuer`
    // alone isn't a safe enough signal -- it has a positional fallback
    // (remaining[1]) that can populate from page-chrome lines too.
    .filter((e) => e.name && (e.issuedDate || e.credentialId));
}

// Self-view (viewing your own profile) Skills pagination pages use "hr"
// dividers too, but with none of the "Endorse" structure the public-view
// path groups by -- each group reduces to just a name (occasionally with
// one context line, e.g. the role it's associated with) once the
// self-edit chrome ("edit_skills", "Edit <name> skill", etc) is filtered.
function parseSkillsSelfViewGroup(lines) {
  if (!lines.length) return null;
  return { name: lines[0], context: lines.slice(1) };
}

function parseSkillsSelfView(rawLines) {
  const groups = groupByDivider(rawLines);
  return groups.map(parseSkillsSelfViewGroup).filter(Boolean);
}

module.exports = {
  parseExperienceSection,
  parseEducationSection,
  parseCertificationSection,
  parseSkillsSelfView,
};
