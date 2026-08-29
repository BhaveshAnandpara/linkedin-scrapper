import { readFileSync, writeFileSync } from "fs";

const publicIdentifier = process.argv[2];
const outFile = process.argv[3];
if (!publicIdentifier || !outFile) {
  console.error("usage: node _fetch-profile.mjs <publicIdentifier> <outFile>");
  process.exit(1);
}

const curlText = readFileSync("d:/Tross/linkedin-scrapper/reference/_full-curl.txt", "utf8");
const cookieMatch = curlText.match(/-b '([^']*)'/);
let cookieJar = cookieMatch[1];

const freshLiAt = process.env.LI_AT_COOKIE;
const freshJsession = (process.env.LI_JSESSIONID || "").replace(/^"|"$/g, "");
cookieJar = cookieJar.replace(/li_at=[^;]+/, `li_at=${freshLiAt}`);
cookieJar = cookieJar.replace(/JSESSIONID=("?)[^;]+\1/, `JSESSIONID="${freshJsession}"`);

const headerRe = /-H '([^:]+):\s*([^']*)'/g;
const headers = {};
let m;
while ((m = headerRe.exec(curlText)) !== null) headers[m[1].toLowerCase()] = m[2];
headers["cookie"] = cookieJar;
headers["csrf-token"] = freshJsession;
headers["accept"] = "application/json";
headers["referer"] = `https://www.linkedin.com/in/${publicIdentifier}/`;

const url = `https://www.linkedin.com/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${publicIdentifier}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-93`;

const res = await fetch(url, { headers, redirect: "manual" });
console.log(publicIdentifier, "-> status:", res.status);

if (res.status === 200) {
  const text = await res.text();
  writeFileSync(`d:/Tross/linkedin-scrapper/reference/${outFile}`, text, "utf8");
  console.log("saved", text.length, "bytes to reference/" + outFile);
  const data = JSON.parse(text);
  const p = data.elements && data.elements[0];
  if (p) {
    console.log("  name:", p.firstName, p.lastName);
    console.log("  headline:", p.headline);
    console.log("  positions:", p.profilePositionGroups && p.profilePositionGroups.paging.total);
    console.log("  educations:", p.profileEducations && p.profileEducations.paging.total);
    console.log("  skills:", p.profileSkills && p.profileSkills.paging.total);
  } else {
    console.log("  no elements[0] — response shape:", Object.keys(data));
  }
} else {
  const text = await res.text();
  console.log("  location:", res.headers.get("location"));
  console.log("  body preview:", text.slice(0, 300));
}
