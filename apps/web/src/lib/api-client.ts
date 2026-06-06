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

function createHeaders(token?: string) {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function parseError(response: Response) {
  const fallback = `Request failed with status ${response.status}`;

  try {
    const payload = (await response.json()) as { message?: string };
    return payload.message || fallback;
  } catch {
    return fallback;
  }
}

export async function apiGetJson<T>(path: string, token?: string): Promise<T> {
  const response = await apiFetch(path, {
    headers: createHeaders(token),
  });

  if (!response.ok) {
    throw new ApiError(await parseError(response), response.status);
  }

  try {
    return (await response.json()) as T;
  } catch (e) {
    throw new ApiError(
      e instanceof Error ? e.message : "Failed to parse response",
      response.status,
    );
  }
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

  try {
    return (await response.json()) as T;
  } catch (e) {
    throw new ApiError(
      e instanceof Error ? e.message : "Failed to parse response",
      response.status,
    );
  }
}
