// Loose types for LinkedIn's raw Voyager `dash/profiles` response.
// Only the fields profileParser.ts actually reads are typed — the real
// response carries dozens of unused fields (see reference/endpoint-notes.md).
// Everything here is optional/loose by design since this is undocumented
// and known to drift.

export interface RawDateComponent {
  month?: number;
  year?: number;
}

export interface RawDateRange {
  start?: RawDateComponent;
  end?: RawDateComponent;
}

export interface RawVectorArtifact {
  width?: number;
  height?: number;
  fileIdentifyingUrlPathSegment?: string;
}

export interface RawVectorImage {
  rootUrl?: string;
  artifacts?: RawVectorArtifact[];
}

export interface RawImageReference {
  vectorImage?: RawVectorImage;
}

export interface RawPaging {
  total?: number;
}

export interface RawCollection<T> {
  paging?: RawPaging;
  elements?: T[];
}

export interface RawPosition {
  title?: string;
  companyName?: string;
  locationName?: string;
  dateRange?: RawDateRange;
  description?: string;
}

export interface RawPositionGroup {
  companyName?: string;
  profilePositionInPositionGroup?: RawCollection<RawPosition>;
}

export interface RawEducation {
  school?: { name?: string };
  schoolName?: string;
  degreeName?: string;
  fieldOfStudy?: string;
  dateRange?: RawDateRange;
  description?: string;
}

export interface RawSkill {
  name?: string;
}

export interface RawCertification {
  name?: string;
  authority?: string;
  dateRange?: RawDateRange;
  url?: string;
}

export interface RawLanguage {
  name?: string;
  proficiency?: string;
}

export interface RawGeoLocation {
  geo?: { defaultLocalizedName?: string };
}

export interface RawLocation {
  countryCode?: string;
}

export interface RawProfileElement {
  firstName?: string;
  lastName?: string;
  headline?: string;
  summary?: string;
  publicIdentifier?: string;
  geoLocation?: RawGeoLocation;
  location?: RawLocation;
  profilePicture?: { displayImageReference?: RawImageReference };
  profilePositionGroups?: RawCollection<RawPositionGroup>;
  profileEducations?: RawCollection<RawEducation>;
  profileSkills?: RawCollection<RawSkill>;
  profileCertifications?: RawCollection<RawCertification>;
  profileLanguages?: RawCollection<RawLanguage>;
}

export interface RawProfileDashResponse {
  elements?: RawProfileElement[];
}
