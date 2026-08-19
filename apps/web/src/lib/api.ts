// ============================================================
// API Configuration & Client
// ============================================================

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = new RegExp(/csrf_token=([^;]+)/).exec(document.cookie);
  return match ? decodeURIComponent(match[1]) : null;
}

let csrfTokenPromise: Promise<string | null> | null = null;

export async function ensureCsrfToken(): Promise<string | null> {
  const existing = getCsrfToken();
  if (existing) return existing;
  if (typeof window === "undefined") return null;

  if (!csrfTokenPromise) {
    csrfTokenPromise = (async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/auth/csrf-token`, {
          credentials: "include",
        });
        if (res.ok) {
          const raw = (await res.json()) as {
            csrfToken?: string;
            data?: { csrfToken?: string };
          };
          return raw.data?.csrfToken || raw.csrfToken || getCsrfToken();
        }
      } catch {
        // ignore fetch failures
      } finally {
        csrfTokenPromise = null;
      }
      return getCsrfToken();
    })();
  }

  return csrfTokenPromise;
}

export async function apiFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${API_URL}${path}`;
  const method = options.method?.toUpperCase() ?? "GET";
  const isMutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method);

  const headers = new Headers(options.headers);

  if (isMutating) {
    // Mutating requests must include the csrf_token cookie AND the
    // matching X-CSRF-Token header so the server-side CsrfGuard can
    // validate the double-submit pattern on cross-origin requests.
    let csrfToken = getCsrfToken();
    if (!csrfToken && typeof window !== "undefined") {
      csrfToken = await ensureCsrfToken();
    }
    if (csrfToken) {
      headers.set("X-CSRF-Token", csrfToken);
    }
  }

  return fetch(url, {
    ...options,
    headers,
    credentials: isMutating ? "include" : options.credentials,
  });
}
