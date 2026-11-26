/**
 * Validates external URLs for safe rendering in <a href> and backend inspection.
 * Allows strictly http: and https: protocols.
 */
export function sanitizeExternalUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Checks whether a URL points to a public internet host (blocks localhost/private/link-local IPs).
 */
export function isSafePublicHttpUrl(rawUrl: string | null | undefined): boolean {
  const safe = sanitizeExternalUrl(rawUrl);
  if (!safe) return false;

  try {
    const { hostname } = new URL(safe);
    const lower = hostname.toLowerCase();

    if (
      lower === 'localhost' ||
      lower === '0.0.0.0' ||
      lower === '::1' ||
      lower.endsWith('.local') ||
      lower.endsWith('.internal')
    ) {
      return false;
    }

    // Block private IPv4 ranges and metadata endpoint 169.254.169.254
    const ipv4Match = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const a = Number(ipv4Match[1]);
      const b = Number(ipv4Match[2]);
      if (
        a === 10 ||
        a === 127 ||
        a === 0 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}
