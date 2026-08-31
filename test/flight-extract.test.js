// Tests for lib/flight-extract.js's noise filter -- the single highest-risk
// piece of this codebase (see DEVLOG Step 15/19-onward): every case here
// maps to a real bug that shipped wrong data at some point, either
// filtering out real content or leaking internal Flight-protocol junk
// into a response field.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isNoise, cleanStrings, groupByDivider } = require('../lib/flight-extract');

test('isNoise: does not eat real content that merely LOOKS like noise', () => {
  // Regression: the original hashed-classname regex matched any two
  // space-separated 6-12 char alphanumeric tokens, which silently deleted
  // real two-word skill/title text with no digit in it (DEVLOG Step 15).
  assert.equal(isNoise('Engineering Leadership'), false);
  assert.equal(isNoise('Technical Leadership'), false);
  assert.equal(isNoise('Product Vision'), false);

  // Regression: the enum-constant filter (/^[A-Z]{2,}(_[A-Z]{2,})*$/) used
  // `*` instead of `+`, so it also matched plain acronyms with no
  // underscore at all -- silently deleted "SQL" from a 73-item skills
  // list (DEVLOG Step 15).
  assert.equal(isNoise('SQL'), false);
  assert.equal(isNoise('CSS'), false);
  assert.equal(isNoise('AWS'), false);
  assert.equal(isNoise('CEO'), false);

  // Ordinary sentence content (About/description text) must never be
  // treated as noise.
  assert.equal(isNoise('I build products fast and ship in public.'), false);
});

test('isNoise: filters internal $case/$type discriminator tokens', () => {
  // Confirmed via captured responses to be JSON key names / $case values,
  // never real profile content (found via a real profile fetch, see
  // session notes for navaneeth-jawahar-b3091416a).
  assert.equal(isNoise('screenId'), true);
  assert.equal(isNoise('floatExpression'), true);
  assert.equal(isNoise('floatValue'), true);
  assert.equal(isNoise('embeddedWebView'), true);
  assert.equal(isNoise('google.protobuf.Empty'), true);
});

test('isNoise: filters layout/color enum tokens', () => {
  assert.equal(isNoise('backgroundFaint'), true);
  assert.equal(isNoise('iconKnockout'), true);
  assert.equal(isNoise('fillAvailable'), true);
});

test('isNoise: filters the CSS transform + custom-property noise value', () => {
  // Regression: this exact string ("translate(0px, var(--hash))") was not
  // caught by any filter, so its embedded comma got mistaken for the
  // degree/field separator in parseEducationGroup, corrupting the first
  // education entry.
  assert.equal(isNoise('translate(0px, var(--46d8fc60))'), true);
  assert.equal(isNoise('translate(-12px, var(--ab184435))'), true);
  // plain CSS custom-property refs (no transform wrapper) still filtered
  assert.equal(isNoise('var(--46d8fc60)'), true);
  assert.equal(isNoise('var(--_4c78be03)'), true);
});

test('isNoise: filters other confirmed structural junk categories', () => {
  assert.equal(isNoise('_5d302b6a a6bc4c2c'), true); // hashed classNames (digit required)
  assert.equal(isNoise('div'), true); // HTML tag name
  assert.equal(isNoise('SHORT_PRESS'), true); // enum constant, underscore required
  assert.equal(isNoise('ColorScheme_UNKNOWN'), true);
  assert.equal(isNoise('123e4567-e89b-12d3-a456-426614174000'), true); // UUID
  assert.equal(isNoise('a'), true); // single char (react array-index key)
  assert.equal(isNoise('42'), true); // pure numeric index key
  assert.equal(isNoise('some-kebab-identifier'), true); // 3+ kebab segments
  assert.equal(
    isNoise('https://media.licdn.com/dms/image/v2/foo/profile-displayphoto-shrink_100_100/bar?v=beta&t=abc'),
    true
  ); // CDN media URL
});

test('cleanStrings: dedupes consecutive repeats but keeps non-consecutive ones', () => {
  // LinkedIn duplicates text for hidden a11y spans -- consecutive dupes
  // are noise, but the same skill legitimately appearing twice non-
  // consecutively (e.g. two different entries) must survive.
  const out = cleanStrings(['Python', 'Python', 'Java', 'Python']);
  assert.deepEqual(out, ['Python', 'Java', 'Python']);
});

test('groupByDivider: splits on the "hr" token, drops empty groups, cleans each group', () => {
  const raw = [
    'chrome before first entry', // dropped: no company/school anchor of its own here, but grouping itself doesn't care
    'hr',
    'Entry Two', 'div', // "div" is noise, should be cleaned out of the group
    'hr',
    'hr', // an empty group between two dividers must be dropped, not returned as []
    'Entry Four',
  ];
  const groups = groupByDivider(raw);
  assert.deepEqual(groups, [
    ['chrome before first entry'],
    ['Entry Two'],
    ['Entry Four'],
  ]);
});
