// Client IP extraction, used to key the per-IP rate limiter. Pure function
// over a plain headers object (not the full VercelRequest) so it stays
// unit-testable without mocking request internals.

export type ClientIpHeaders = Record<string, string | string[] | undefined>;

export function getClientIp(headers: ClientIpHeaders, remoteAddress?: string): string {
  const forwarded = firstValue(headers["x-forwarded-for"]);
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  const realIp = firstValue(headers["x-real-ip"]);
  if (realIp) {
    return realIp.trim();
  }

  if (remoteAddress) {
    return remoteAddress;
  }

  return "unknown";
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
