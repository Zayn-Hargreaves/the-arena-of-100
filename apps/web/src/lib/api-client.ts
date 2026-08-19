import { apiFetch } from "@/lib/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Distinct subclass so callers can `instanceof`-check JSON parse
 * failures separately from genuine HTTP errors. Status is 0 to
 * make the failure mode obvious in logs and match handlers.
 */
export class JsonParseError extends ApiError {
  constructor(message: string) {
    super(message, 0);
    this.name = "JsonParseError";
  }
}

function createHeaders(token?: string) {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function parseArrayMessages(raw: unknown[]): string | undefined {
  if (raw.length === 0) return undefined;
  const parts: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) return undefined;
    parts.push(item.trim());
  }
  return parts.join(", ") || undefined;
}

function parseMessageValue(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    return raw.trim() || undefined;
  }
  if (Array.isArray(raw)) {
    return parseArrayMessages(raw);
  }
  return undefined;
}

function parseErrorPayload(payload: unknown): string | undefined {
  if (typeof payload === "string") {
    return payload.trim() || undefined;
  }
  if (payload && typeof payload === "object") {
    const obj = payload as {
      message?: unknown;
      error?: { message?: unknown; code?: unknown };
      code?: unknown;
    };
    const fromMessage = parseMessageValue(obj.message);
    if (fromMessage) return fromMessage;
    if (obj.error) {
      const fromNested = parseMessageValue(obj.error.message);
      if (fromNested) return fromNested;
      if (typeof obj.error.code === "string" && obj.error.code.trim()) {
        return obj.error.code.trim();
      }
    }
    if (typeof obj.code === "string" && obj.code.trim()) {
      return obj.code.trim();
    }
  }
  return undefined;
}

async function parseError(response: Response) {
  const fallback = `Request failed with status ${response.status}`;

  try {
    const payload: unknown = await response.json();
    return parseErrorPayload(payload) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Parses the body and throws a JsonParseError (status 0) if the
 * body is unparseable. Otherwise returns the typed body. We use
 * 0 — not the response status — because a successful HTTP
 * response that fails to parse is not a 2xx success.
 */
async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  try {
    const raw = (await response.json()) as unknown;
    if (
      raw &&
      typeof raw === "object" &&
      "success" in raw &&
      (raw as { success?: unknown }).success === true &&
      "data" in raw
    ) {
      return (raw as { data: T }).data;
    }
    return raw as T;
  } catch (e) {
    throw new JsonParseError(
      e instanceof Error ? e.message : "Failed to parse response",
    );
  }
}

export async function apiGetJson<T>(path: string, token?: string): Promise<T> {
  const response = await apiFetch(path, {
    headers: createHeaders(token),
  });

  if (!response.ok) {
    throw new ApiError(await parseError(response), response.status);
  }

  return parseJsonOrThrow<T>(response);
}

export async function apiSendJson<T>(
  path: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body: unknown,
  token?: string,
): Promise<T> {
  const response = await apiFetch(path, {
    method,
    headers: createHeaders(token),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new ApiError(await parseError(response), response.status);
  }

  return parseJsonOrThrow<T>(response);
}
