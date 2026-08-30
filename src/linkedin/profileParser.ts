// Raw LinkedIn dash-profile JSON -> the public ProfileResponse contract.
// Pure function, primary TDD seam. Deliberately defensive: LinkedIn's raw
// shape is undocumented and known to drift, so every field access is
// optional-chained and missing sections resolve to empty arrays / undefined
// rather than throwing.

import type {
  DatePart,
  ProfileImage,
  ExperienceEntry,
  EducationEntry,
  SkillEntry,
  CertificationEntry,
  LanguageEntry,
  ProfileResponse,
} from "../types/profile.js";
import type {
  RawProfileDashResponse,
  RawDateComponent,
  RawCollection,
  RawPositionGroup,
  RawPosition,
  RawEducation,
  RawSkill,
  RawCertification,
  RawLanguage,
  RawVectorImage,
} from "../types/linkedin-raw.js";

export type ProfileParseResult =
  | { ok: true; profile: ProfileResponse }
  | { ok: false; error: "NO_PROFILE_DATA" };

export function parseProfile(raw: unknown, requestedUrl: string): ProfileParseResult {
  const element = (raw as RawProfileDashResponse | undefined)?.elements?.[0];
  if (!element) {
    return { ok: false, error: "NO_PROFILE_DATA" };
  }

  const images = extractImages(element.profilePicture?.displayImageReference?.vectorImage);
  const experience = flattenExperience(element.profilePositionGroups);
  const education = mapEducation(element.profileEducations);
  const skills = mapSkills(element.profileSkills);
  const certifications = mapCertifications(element.profileCertifications);
  const languages = mapLanguages(element.profileLanguages);

  const limitations = [
    collectionLimitation("experience", element.profilePositionGroups),
    collectionLimitation("education", element.profileEducations),
    collectionLimitation("skills", element.profileSkills),
    collectionLimitation("certifications", element.profileCertifications),
    collectionLimitation("languages", element.profileLanguages),
  ].filter((entry): entry is string => entry !== null);

  const profile: ProfileResponse = {
    requestedUrl,
    publicIdentifier: element.publicIdentifier ?? "",
    name: [element.firstName, element.lastName].filter(Boolean).join(" ").trim(),
    headline: element.headline || undefined,
    location: element.geoLocation?.geo?.defaultLocalizedName || element.location?.countryCode || undefined,
    about: element.summary || undefined,
    profileImage: pickPrimaryImage(images),
    profileImages: images.length > 0 ? images : undefined,
    experience,
    education,
    skills,
    certifications,
    languages,
    meta: {
      fetchedAt: new Date().toISOString(),
      partial: limitations.length > 0,
      limitations: limitations.length > 0 ? limitations : undefined,
    },
  };

  return { ok: true, profile };
}

function collectionLimitation(label: string, collection: RawCollection<unknown> | undefined): string | null {
  const total = collection?.paging?.total;
  const count = collection?.elements?.length ?? 0;
  if (typeof total === "number" && total > count) {
    return `${label}: showing ${count} of ${total}`;
  }
  return null;
}

function mapDate(raw: RawDateComponent | undefined): DatePart | undefined {
  if (!raw || typeof raw.year !== "number") {
    return undefined;
  }
  return typeof raw.month === "number" ? { month: raw.month, year: raw.year } : { year: raw.year };
}

function extractImages(vectorImage: RawVectorImage | undefined): ProfileImage[] {
  const rootUrl = vectorImage?.rootUrl;
  if (!rootUrl) {
    return [];
  }
  const artifacts = vectorImage?.artifacts ?? [];
  return artifacts
    .filter((artifact) => !!artifact.fileIdentifyingUrlPathSegment)
    .map((artifact) => ({
      url: `${rootUrl}${artifact.fileIdentifyingUrlPathSegment}`,
      width: artifact.width,
      height: artifact.height,
    }));
}

function pickPrimaryImage(images: ProfileImage[]): ProfileImage | undefined {
  if (images.length === 0) {
    return undefined;
  }
  return images.reduce((best, image) => ((image.width ?? 0) > (best.width ?? 0) ? image : best), images[0]!);
}

function flattenExperience(
  positionGroups: RawCollection<RawPositionGroup> | undefined,
): ExperienceEntry[] {
  const groups = positionGroups?.elements ?? [];
  const experience: ExperienceEntry[] = [];

  for (const group of groups) {
    const positions = group.profilePositionInPositionGroup?.elements ?? [];
    if (positions.length > 0) {
      for (const position of positions) {
        experience.push(mapPosition(position, group));
      }
    } else if (group.companyName) {
      experience.push(mapPosition({}, group));
    }
  }

  return experience;
}

function mapPosition(position: RawPosition, group: RawPositionGroup): ExperienceEntry {
  const hasEnd = position.dateRange?.end != null;
  return {
    title: position.title ?? "",
    company: position.companyName ?? group.companyName ?? "",
    location: position.locationName,
    startDate: mapDate(position.dateRange?.start),
    endDate: hasEnd ? mapDate(position.dateRange!.end) : null,
    isCurrent: !hasEnd,
    description: position.description,
  };
}

function mapEducation(educations: RawCollection<RawEducation> | undefined): EducationEntry[] {
  const elements = educations?.elements ?? [];
  return elements.map((entry) => ({
    school: entry.school?.name ?? entry.schoolName ?? "",
    degree: entry.degreeName,
    fieldOfStudy: entry.fieldOfStudy,
    startYear: entry.dateRange?.start?.year,
    endYear: entry.dateRange?.end?.year,
    description: entry.description,
  }));
}

function mapSkills(skills: RawCollection<RawSkill> | undefined): SkillEntry[] {
  const elements = skills?.elements ?? [];
  return elements.map((entry) => ({ name: entry.name ?? "" }));
}

function mapCertifications(
  certifications: RawCollection<RawCertification> | undefined,
): CertificationEntry[] {
  const elements = certifications?.elements ?? [];
  return elements.map((entry) => ({
    name: entry.name ?? "",
    issuingOrganization: entry.authority,
    issueDate: mapDate(entry.dateRange?.start),
    expirationDate: entry.dateRange?.end ? mapDate(entry.dateRange.end) : null,
    credentialUrl: entry.url,
  }));
}

function mapLanguages(languages: RawCollection<RawLanguage> | undefined): LanguageEntry[] {
  const elements = languages?.elements ?? [];
  return elements.map((entry) => ({
    name: entry.name ?? "",
    proficiency: humanizeProficiency(entry.proficiency),
  }));
}

function humanizeProficiency(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  return raw
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
