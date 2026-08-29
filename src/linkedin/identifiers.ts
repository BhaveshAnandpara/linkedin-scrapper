// parseProfileUrl(): linkedin.com/in/{slug} -> publicIdentifier | INVALID_URL.
// Pure function, secondary TDD seam.

export type IdentifierResult =
  | { ok: true; publicIdentifier: string }
  | { ok: false; error: "INVALID_URL" };

const SLUG_PATTERN = /^[a-zA-Z0-9-]+$/;

export function parseProfileUrl(input: string): IdentifierResult {
  if (!input) {
    return { ok: false, error: "INVALID_URL" };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    try {
      url = new URL(`https://${input}`);
    } catch {
      return { ok: false, error: "INVALID_URL" };
    }
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "linkedin.com") {
    return { ok: false, error: "INVALID_URL" };
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2 || segments[0] !== "in") {
    return { ok: false, error: "INVALID_URL" };
  }

  const publicIdentifier = segments[1];
  if (!publicIdentifier || !SLUG_PATTERN.test(publicIdentifier)) {
    return { ok: false, error: "INVALID_URL" };
  }

  return { ok: true, publicIdentifier };
}
