import { readFileSync, writeFileSync } from "fs";

const inFile = process.argv[2];
const outFile = process.argv[3];
const fakeIndex = process.argv[4] || "1";

const SENSITIVE_STRING_KEYS = new Set([
  "firstName", "lastName", "headline", "summary", "companyName", "schoolName",
  "publicIdentifier", "trackingId",
]);
const SENSITIVE_LOCALE_MAP_KEYS = new Set([
  "multiLocaleFirstName", "multiLocaleLastName", "multiLocaleHeadline", "multiLocaleSummary",
  "multiLocaleCompanyName", "multiLocaleSchoolName", "multiLocaleFullNamePronunciationAudio",
]);
const URL_LIKE_KEYS = new Set(["rootUrl", "fileIdentifyingUrlPathSegment", "url"]);
const OPAQUE_ID_KEYS = new Set(["entityUrn", "objectUrn", "$anti_abuse_uuid", "versionTag"]);

const fake = {
  firstName: "Test",
  lastName: `Person${fakeIndex}`,
  headline: "Example Role | Example Specialty | Open to Opportunities",
  summary: "This is a sanitized example summary used for testing purposes only.",
  companyNames: ["Example Corp A", "Example Corp B", "Example Corp C", "Example Corp D", "Example Corp E"],
  schoolNames: ["Example University A", "Example University B"],
};

let companyCounter = 0;
let schoolCounter = 0;
let opaqueCounter = 0;

function fakeCompany() {
  const name = fake.companyNames[companyCounter % fake.companyNames.length];
  companyCounter++;
  return name;
}
function fakeSchool() {
  const name = fake.schoolNames[schoolCounter % fake.schoolNames.length];
  schoolCounter++;
  return name;
}
function fakeOpaqueId(original) {
  opaqueCounter++;
  return `urn:li:fakeEntity:${fakeIndex}-${opaqueCounter}`;
}

function walk(node) {
  if (Array.isArray(node)) {
    return node.map(walk);
  }
  if (node && typeof node === "object") {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (SENSITIVE_LOCALE_MAP_KEYS.has(key) && value && typeof value === "object") {
        const replacement = {};
        for (const locale of Object.keys(value)) {
          if (key.includes("FirstName")) replacement[locale] = fake.firstName;
          else if (key.includes("LastName")) replacement[locale] = fake.lastName;
          else if (key.includes("Headline")) replacement[locale] = fake.headline;
          else if (key.includes("Summary")) replacement[locale] = fake.summary;
          else if (key.includes("CompanyName")) replacement[locale] = fakeCompany();
          else if (key.includes("SchoolName")) replacement[locale] = fakeSchool();
          else replacement[locale] = "REDACTED";
        }
        out[key] = replacement;
      } else if (key === "firstName") out[key] = fake.firstName;
      else if (key === "lastName") out[key] = fake.lastName;
      else if (key === "headline") out[key] = fake.headline;
      else if (key === "summary") out[key] = fake.summary;
      else if (key === "companyName") out[key] = fakeCompany();
      else if (key === "schoolName") out[key] = fakeSchool();
      else if (key === "publicIdentifier") out[key] = `test-person-${fakeIndex}`;
      else if (key === "trackingId") out[key] = "REDACTED_TRACKING_ID";
      else if (URL_LIKE_KEYS.has(key) && typeof value === "string") out[key] = "https://example.com/redacted";
      else if (/Url$/.test(key) && typeof value === "string" && /licdn\.com/i.test(value)) out[key] = "https://example.com/redacted";
      else if (OPAQUE_ID_KEYS.has(key) && typeof value === "string") out[key] = fakeOpaqueId(value);
      else out[key] = walk(value);
    }
    return out;
  }
  if (typeof node === "string" && /licdn\.com/i.test(node)) {
    return "https://example.com/redacted";
  }
  return node;
}

const raw = JSON.parse(readFileSync(inFile, "utf8"));
const sanitized = walk(raw);
let text = JSON.stringify(sanitized, null, 2);

// final safety-net pass: scrub any remaining literal occurrences of known real
// names/companies (e.g. embedded in filenames, titles, or other fields the
// structural pass above didn't specifically target), passed as extra CLI args
const extraTokens = process.argv.slice(5).filter(Boolean);
for (const token of extraTokens) {
  const re = new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  text = text.replace(re, "REDACTED");
}

writeFileSync(outFile, text, "utf8");
console.log("sanitized", inFile, "->", outFile, extraTokens.length ? `(scrubbed: ${extraTokens.join(", ")})` : "");
