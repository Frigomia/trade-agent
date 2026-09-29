import { createClient } from "@/lib/supabase/client";

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

function buildHeaders(init: RequestInit, authorization?: string): Headers {
  // Built through the Headers constructor (not object spread) so caller-supplied headers work
  // regardless of whether init.headers is a plain object, a Headers instance, or a tuple array —
  // object spread only handles the plain-object shape and silently drops the other two.
  const headers = new Headers(init.headers);
  if (authorization) {
    headers.set("Authorization", authorization);
  }
  // Skipped for FormData bodies: the browser needs to set its own multipart boundary in
  // Content-Type, which a force-set "application/json" would stomp on.
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

async function handleApiResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: string | { msg: string }[] };
      if (typeof body.detail === "string") {
        detail = body.detail;
      } else if (Array.isArray(body.detail)) {
        // FastAPI's default 422 validation-error shape: { detail: [{ loc, msg, type }, ...] }.
        detail = body.detail.map((error) => error.msg).join("; ");
      }
    } catch {
      // Error body wasn't JSON (a proxy error page, a timeout) — statusText is still useful.
    }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

function requireBaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new Error("NEXT_PUBLIC_API_URL is not set");
  }
  return baseUrl;
}

/** Browser-only: reads the auth token from the current Supabase browser session. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = requireBaseUrl();
  const authHeader = await getAuthHeader();
  const headers = buildHeaders(init, authHeader.Authorization);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  return handleApiResponse<T>(response);
}

/**
 * Server-only: for Server Components/proxy.ts, which don't have the browser Supabase client's
 * session available and must pass an explicit access token instead (from the server Supabase
 * client, see lib/supabase/server.ts). Same ApiError/error-parsing logic as apiFetch — the only
 * difference is where the token comes from.
 */
export async function apiFetchServer<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const baseUrl = requireBaseUrl();
  const headers = buildHeaders(init, `Bearer ${accessToken}`);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  return handleApiResponse<T>(response);
}
