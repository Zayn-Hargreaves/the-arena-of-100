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

async function parseError(response: Response) {
  const fallback = `Request failed with status ${response.status}`;

  try {
    // Parse as `unknown` and validate at runtime — we never trust
    // the error-payload shape. The DTO contract (when present)
    // allows `message: string | string[]`, but the server may also
    // surface a 401 page, a proxy error, a sanitized message, or
    // a non-JSON body. We accept only:
    //   1. a non-empty string, OR
    //   2. an array whose every item is a non-empty string.
    // Anything else (object, number, boolean, null, mixed/empty
    // arrays, etc.) ⇒ `fallback`.
    const payload: unknown = await response.json();
    if (typeof payload === "string") {
      return payload.trim() ? payload : fallback;
    }
    if (payload && typeof payload === "object") {
      const raw = (payload as { message?: unknown }).message;
      if (typeof raw === "string") {
        return raw.trim() ? raw : fallback;
      }
      if (Array.isArray(raw)) {
        const parts = raw.filter(
          (p): p is string => typeof p === "string" && p.trim().length > 0,
        );
        if (parts.length === raw.length && parts.length > 0) {
          return parts.join(", ");
        }
      }
    }
    return fallback;
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
    return (await response.json()) as T;
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
