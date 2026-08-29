export interface DatePart {
  month?: number;
  year: number;
}

export interface ProfileImage {
  url: string;
  width?: number;
  height?: number;
}

export interface ExperienceEntry {
  title: string;
  company: string;
  location?: string;
  startDate?: DatePart;
  endDate?: DatePart | null;
  isCurrent: boolean;
  description?: string;
}

export interface EducationEntry {
  school: string;
  degree?: string;
  fieldOfStudy?: string;
  startYear?: number;
  endYear?: number;
  description?: string;
}

export interface SkillEntry {
  name: string;
  endorsementCount?: number;
}

export interface CertificationEntry {
  name: string;
  issuingOrganization?: string;
  issueDate?: DatePart;
  expirationDate?: DatePart | null;
  credentialUrl?: string;
}

export interface LanguageEntry {
  name: string;
  proficiency?: string;
}

export interface ProfileResponse {
  requestedUrl: string;
  publicIdentifier: string;
  name: string;
  headline?: string;
  location?: string;
  about?: string;
  profileImage?: ProfileImage;
  profileImages?: ProfileImage[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  skills: SkillEntry[];
  certifications: CertificationEntry[];
  languages: LanguageEntry[];
  meta: {
    fetchedAt: string;
    partial: boolean;
    limitations?: string[];
  };
}

export type ApiErrorCode =
  | "INVALID_URL"
  | "PROFILE_NOT_FOUND"
  | "PROFILE_PRIVATE"
  | "SESSION_EXPIRED"
  | "LOGIN_CHALLENGE"
  | "LINKEDIN_RATE_LIMITED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}
