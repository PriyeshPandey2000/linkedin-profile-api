// Shared types describing a scraped LinkedIn profile. These mirror the
// structured JSON returned by lib/fetch-profile.ts and surfaced through
// the POST /profile endpoint -- the source of truth for ProfileData.
//
// Nullability here matches what the runtime ACTUALLY returns (nullable
// where a field can legitimately be absent for a given profile), so this
// stays structurally assignable from lib/fetch-profile.ts's own shape.

export interface ExperienceEntry {
  title: string | null;
  company: string | null;
  employmentType: string | null;
  dates: string | null;
  location: string | null;
  description: string[];
  skills: string | null;
  multipleRoles?: boolean;
}

export interface EducationEntry {
  school: string | null;
  degree: string | null;
  field: string | null;
  dates: string | null;
  grade: string | null;
}

export interface CertificationEntry {
  name: string | null;
  issuer: string | null;
  issuedDate: string | null;
  credentialId: string | null;
}

export interface SkillEntry {
  name: string;
  context: string[];
}

export interface LanguageEntry {
  name: string;
  proficiency: string;
}

export interface ProfileData {
  name: string | null;
  headline: string | null;
  location: string | null;
  profileImage: string | null;
  about: string | null;
  experience: ExperienceEntry[];
  education: EducationEntry[];
  certifications: CertificationEntry[];
  skills: SkillEntry[];
  languages: LanguageEntry[];
  projects: string[] | null;
}
