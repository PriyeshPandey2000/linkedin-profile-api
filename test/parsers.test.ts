// Tests for lib/parsers.ts -- turning raw "hr"-divided line groups into
// typed Experience/Education/Certification objects. Fixtures below are
// shaped like real captured raw-line arrays (pre-clean, "hr" dividers
// intact), not simplified toy data, so they exercise the same positional/
// pattern-matching logic real responses hit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseExperienceSection,
  parseEducationSection,
  parseCertificationSection,
  parseSkillsSelfView,
} from '../lib/parsers';

test('parseCertificationSection: the page heading does not shift the first entry\'s fields', () => {
  // Regression: "Licenses & certifications" (the section heading) has no
  // "hr" before it, so it lands INSIDE the first entry's raw-line group
  // instead of as its own group. Left unfiltered, it pushed the real cert
  // name into the `issuer` slot and something else into `name`.
  const raw = [
    'Licenses & certifications',
    'PBEL Equivalent to Virtual Internship - Blockchain',
    'IBMMooc logo',
    'IBMMooc',
    'Issued Jul 2025',
    'Credential ID 684ea2b3b4414d9581c055897e40d2c6',
    'Show credential',
    'hr',
    'Python - IITM Pravartak Certified',
    'HCL GUVI logo',
    'HCL GUVI',
    'Issued Jul 2025',
    'Credential ID 70i12U660w732QJ5ab',
  ];
  const result = parseCertificationSection(raw);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    name: 'PBEL Equivalent to Virtual Internship - Blockchain',
    issuer: 'IBMMooc',
    issuedDate: 'Jul 2025',
    credentialId: '684ea2b3b4414d9581c055897e40d2c6',
  });
  assert.equal(result[1].name, 'Python - IITM Pravartak Certified');
});

test('parseCertificationSection: heading with a trailing count "(12)" is also stripped', () => {
  const raw = [
    'Licenses & certifications (12)',
    'Some Cert Name',
    'Some Issuer logo',
    'Issued Jan 2024',
    'Credential ID abc123',
  ];
  const result = parseCertificationSection(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Some Cert Name');
});

test('parseCertificationSection: drops page-chrome groups with no issuedDate/credentialId', () => {
  const raw = [
    'Show all 12 licenses', // trailing footer link, no real entry data
    'hr',
    'Real Cert',
    'Real Issuer logo',
    'Issued Mar 2023',
    'Credential ID xyz',
  ];
  const result = parseCertificationSection(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Real Cert');
});

test('parseEducationSection: the "Education" heading does not shift degree/field', () => {
  const raw = [
    'Education',
    'Kendriya Vidyalaya (KV) logo',
    'Kendriya Vidyalaya (KV)',
    'High School Diploma, Computer Science',
    'May 2012 – Apr 2024',
  ];
  const result = parseEducationSection(raw);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    school: 'Kendriya Vidyalaya (KV)',
    degree: 'High School Diploma',
    field: 'Computer Science',
    dates: 'May 2012 – Apr 2024',
    grade: null,
  });
});

test('parseEducationSection: degree with no comma leaves field null', () => {
  const raw = [
    'BSA Crescent Institute of Science and Technology logo',
    'BSA Crescent Institute of Science and Technology',
    'Bachelor of Technology - BTech, Information Technology',
  ];
  const result = parseEducationSection(raw);
  assert.equal(result[0].degree, 'Bachelor of Technology - BTech');
  assert.equal(result[0].field, 'Information Technology');
});

test('parseExperienceSection: single-role entry extracts every field by pattern, not position', () => {
  const raw = [
    'MeetStream AI logo',
    'Co-Founder & CTO',
    'MeetStream AI · Permanent Full-time',
    'Jan 2026 - Present · 8 mos',
    'San Francisco Bay Area · Hybrid',
    'Cloud Infrastructure, Technical Leadership and +3 skills',
  ];
  const result = parseExperienceSection(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0].company, 'MeetStream AI');
  assert.equal(result[0].title, 'Co-Founder & CTO');
  assert.equal(result[0].dates, 'Jan 2026 - Present · 8 mos');
  assert.equal(result[0].location, 'San Francisco Bay Area · Hybrid');
  assert.equal(result[0].skills, 'Cloud Infrastructure, Technical Leadership and +3 skills');
});

test('parseExperienceSection: multiple DISTINCT date ranges triggers multipleRoles, a single duplicated one does not', () => {
  // A11y markup duplicates a single role's date line -- must not be
  // mistaken for a second role (DEVLOG: distinctDateValues, not raw count).
  const singleRoleDuplicatedDate = [
    'Acme Corp logo',
    'Engineer',
    'Jan 2020 - Present · 4 yrs',
    'Jan 2020 - Present · 4 yrs', // accessibility duplicate of the SAME date line
  ];
  const singleResult = parseExperienceSection(singleRoleDuplicatedDate);
  assert.equal(singleResult.length, 1);
  assert.equal(singleResult[0].multipleRoles, undefined);
  assert.equal(singleResult[0].title, 'Engineer');

  const genuineMultiRole = [
    'Durham College logo',
    'Principal Investigator',
    'Jan 2024 - Present · 2 yrs 8 mos',
    'Research Associate',
    'Jan 2023 - Feb 2024 · 1 yr 2 mos',
  ];
  const multiResult = parseExperienceSection(genuineMultiRole);
  assert.equal(multiResult.length, 1);
  assert.equal(multiResult[0].multipleRoles, true);
  assert.equal(multiResult[0].company, 'Durham College');
  // real text preserved rather than guessed at
  assert.ok(multiResult[0].description.includes('Principal Investigator'));
  assert.ok(multiResult[0].description.includes('Research Associate'));
});

test('parseExperienceSection: page chrome before the first entry is dropped (no company anchor)', () => {
  const raw = [
    'Experience', // section heading, no " logo" line -> no company, filtered out
    'hr',
    'Real Co logo',
    'Real Title',
    'Jan 2022 - Present · 3 yrs',
  ];
  const result = parseExperienceSection(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0].company, 'Real Co');
});

test('parseSkillsSelfView: groups by "hr" with no Endorse structure, first line is the name', () => {
  const raw = ['LangChain', 'Principal Investigator at Durham College', 'hr', 'Kubernetes'];
  const result = parseSkillsSelfView(raw);
  assert.deepEqual(result, [
    { name: 'LangChain', context: ['Principal Investigator at Durham College'] },
    { name: 'Kubernetes', context: [] },
  ]);
});
