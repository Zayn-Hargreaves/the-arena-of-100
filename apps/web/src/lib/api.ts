// ============================================================
// API Configuration & Client
// ============================================================

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
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
    const csrfToken = getCsrfToken();
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
