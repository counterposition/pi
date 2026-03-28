import net from "node:net";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "169.254.169.254",
  "169.254.169.250",
  "100.100.100.200",
]);

export function validateFetchUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Invalid URL: URL is required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid URL: malformed URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Invalid URL: only http and https URLs are allowed.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Invalid URL: embedded credentials are not allowed.");
  }

  const hostname = parsed.hostname.replaceAll(/^\[|\]$/g, "").toLowerCase();
  if (!hostname) {
    throw new Error("Invalid URL: hostname is required.");
  }

  if (isBlockedHostname(hostname)) {
    throw new Error("Blocked URL: target host is not allowed.");
  }

  return parsed.toString();
}

function isBlockedHostname(hostname: string): boolean {
  if (
    BLOCKED_HOSTS.has(hostname) ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home")
  ) {
    return true;
  }

  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4) return isBlockedIpv4(hostname);
  if (ipVersion === 6) return isBlockedIpv6(hostname);

  return false;
}

function isBlockedIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return true;

  const [a, b] = octets;

  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;

  return false;
}

function isBlockedIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();

  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff")
  );
}
