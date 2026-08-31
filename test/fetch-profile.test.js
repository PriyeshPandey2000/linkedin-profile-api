// Tests for the pure, network-free pieces of lib/fetch-profile.js.
// parsePaginatedPage is the highest-value target here: it's the exact
// per-page stop-condition logic that had a real off-by-one bug (a genuine
// full page of 10 certifications was mistaken for a short final page,
// silently truncating a 12-certification profile to 10). Every case below
// is built from the real "hr"/"Endorse" shapes LinkedIn's pagination
// responses actually have, not simplified toy data.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePaginatedPage, extractLanguages, parseTopCard } = require('../lib/fetch-profile');

function rawCertPage(entryCount) {
  // "hr" separates entries but never precedes the FIRST one on a page --
  // a full page of `entryCount` items has `entryCount - 1` "hr" markers.
  const lines = ['Entry 0 name', 'Some Issuer logo', 'Issued Jan 2020', 'Credential ID id0'];
  for (let i = 1; i < entryCount; i++) {
    lines.push('hr', `Entry ${i} name`, 'Some Issuer logo', `Issued Jan 202${i}`, `Credential ID id${i}`);
  }
  return lines;
}

test('parsePaginatedPage: a genuinely FULL hr-divided page does not stop pagination', () => {
  // Regression for the exact bug found on navaneeth-jawahar-b3091416a:
  // a full page of 10 certifications (9 "hr" markers) was being read as
  // "short page, stop here", truncating 12 real certifications to 10.
  const page = rawCertPage(10);
  const result = parsePaginatedPage(page, 10);
  assert.equal(result.stop, false);
  assert.equal(result.items.length, 1);
  assert.ok(result.items[0].__rawPage, 'hr-divided pages are tagged for lib/parsers.js to group');
});

test('parsePaginatedPage: a genuinely SHORT hr-divided final page does stop pagination', () => {
  const page = rawCertPage(2); // the real remainder after a full first page of 10
  const result = parsePaginatedPage(page, 10);
  assert.equal(result.stop, true);
});

test('parsePaginatedPage: an empty page (past the real end) stops with no items', () => {
  const result = parsePaginatedPage([], 10);
  assert.deepEqual(result, { items: [], stop: true });
});

function rawSkillsPage(itemCount) {
  // Skills pages delimit with a per-item "Endorse" marker (every item,
  // including the last, has one) -- unlike hr-divided pages, item count
  // here is exact, no off-by-one.
  const lines = [];
  for (let i = 0; i < itemCount; i++) {
    lines.push(`Skill ${i}`, `context for ${i}`, 'Endorse');
  }
  return lines;
}

test('parsePaginatedPage: a full Endorse-delimited skills page continues pagination', () => {
  const page = rawSkillsPage(10);
  const result = parsePaginatedPage(page, 10);
  assert.equal(result.stop, false);
  assert.equal(result.items.length, 10);
  assert.deepEqual(result.items[0], { name: 'Skill 0', context: ['context for 0'] });
});

test('parsePaginatedPage: a short Endorse-delimited final page stops pagination', () => {
  const page = rawSkillsPage(3);
  const result = parsePaginatedPage(page, 10);
  assert.equal(result.stop, true);
  assert.equal(result.items.length, 3);
});

test('parsePaginatedPage: self-view fallback (no hr, no Endorse) groups one item per line', () => {
  // Self-view Skills pages have neither delimiter -- documented fallback,
  // see README known limitations.
  const manyLines = Array.from({ length: 9 }, (_, i) => `Skill ${i}`);
  const full = parsePaginatedPage(manyLines, 10);
  assert.equal(full.stop, false); // 9 >= 8 threshold, keep paginating
  assert.equal(full.items.length, 9);

  const fewLines = ['Skill 0', 'Skill 1'];
  const short = parsePaginatedPage(fewLines, 10);
  assert.equal(short.stop, true);
});

test('extractLanguages-equivalent pairing is exercised via extractLanguages on a minimal Flight stream', () => {
  // extractLanguages depends on extractSectionsFromResponse, which needs a
  // real Flight-protocol chunk shape -- build the smallest one that has an
  // observabilityIdentifier resolving to "languageTopLevelSection".
  const chunk = JSON.stringify({
    observabilityIdentifier: 'com.linkedin.sdui.impl.languageTopLevelSection',
    children: ['Languages', 'English', 'Native or bilingual proficiency', 'Hindi', 'Professional working proficiency'],
  });
  const raw = `0:${chunk}\n`;
  const result = extractLanguages(raw);
  assert.deepEqual(result, [
    { name: 'English', proficiency: 'Native or bilingual proficiency' },
    { name: 'Hindi', proficiency: 'Professional working proficiency' },
  ]);
});

test('parseTopCard: filters junk headings and picks the real name/headline/location', () => {
  const html = `
    <html><body>
      <h2>0 notifications</h2>
      <h2>Jane Doe</h2><div>He/Him</div><div>Senior Engineer at Acme</div><div>San Francisco, CA</div><div>Contact info</div>
    </body></html>
  `;
  const result = parseTopCard(html);
  assert.equal(result.name, 'Jane Doe');
  assert.equal(result.headline, 'Senior Engineer at Acme');
  assert.equal(result.location, 'San Francisco, CA');
});

test('parseTopCard: picks the highest-resolution photo from the preload imageSrcSet hint', () => {
  const html = `
    <html><head>
      <link rel="preload" as="image" imageSrcSet="https://media.licdn.com/dms/image/foo/profile-displayphoto-shrink_100_100/bar 100w, https://media.licdn.com/dms/image/foo/profile-displayphoto-shrink_400_400/bar 400w">
    </head><body>
      <h2>Jane Doe</h2><div>Engineer</div><div>Contact info</div>
    </body></html>
  `;
  const result = parseTopCard(html);
  assert.ok(result.profileImage.includes('shrink_400_400'), 'should pick the 400w variant, not the 100w one');
});
