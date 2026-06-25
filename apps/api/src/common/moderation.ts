const BANNED_TERMS = ["fuck", "shit", "bitch", "asshole", "damn"];
const DEFAULT_TERMINATION_MESSAGE = "Room terminated by admin";

function normalizeUnicode(value: string): string {
  return value.normalize("NFKC");
}

function maskBannedTerms(value: string): string {
  return BANNED_TERMS.reduce((current, term) => {
    const pattern = term.split("").join("[\\s_\\-*]*");
    const regex = new RegExp(pattern, "gi");
    let next = current.replace(regex, "*".repeat(term.length));
    while (next !== current) {
      current = next;
      next = current.replace(regex, "*".repeat(term.length));
    }
    return current;
  }, normalizeUnicode(value));
}

function normalizeWhitespace(value: string): string {
  return normalizeUnicode(value).trim().replace(/\s+/g, " ");
}

function stripNicknameArtifacts(value: string): string {
  return normalizeUnicode(value).replace(/[^\p{L}\p{M}\p{N}_\- *]/gu, "");
}

function stripModerationArtifacts(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}_\- *]/gu, "");
}

export function baseNormalize(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  return str
    .normalize("NFKC")
    .replace(/[\s_\-*]/g, "")
    .toLowerCase();
}

function canonicalizeForModeration(value: string): string {
  return baseNormalize(stripModerationArtifacts(value));
}

function containsBannedTerm(value: string): boolean {
  const normalized = canonicalizeForModeration(value);
  return BANNED_TERMS.some((term) => normalized.includes(term));
}

export function sanitizeNickname(value: string): string | null {
  const normalized = normalizeWhitespace(value);
  const cleaned = stripNicknameArtifacts(normalized);
  const masked = maskBannedTerms(cleaned);
  const trimmed = normalizeWhitespace(masked);
  const hasContent = /[\p{L}\p{N}]/u.test(canonicalizeForModeration(trimmed));
  const hasBanned = containsBannedTerm(trimmed);
  return hasContent && !hasBanned && trimmed.length >= 3 && trimmed.length <= 20
    ? trimmed
    : null;
}

export function sanitizeAdminMessage(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = normalizeWhitespace(value);
  if (normalized.length === 0) return undefined;
  if (containsBannedTerm(normalized)) return DEFAULT_TERMINATION_MESSAGE;
  return normalized.slice(0, 200);
}
