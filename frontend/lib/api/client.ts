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

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new Error("NEXT_PUBLIC_API_URL is not set");
  }

  const authHeader = await getAuthHeader();
  // Built through the Headers constructor (not object spread) so caller-supplied headers work
  // regardless of whether init.headers is a plain object, a Headers instance, or a tuple array —
  // object spread only handles the plain-object shape and silently drops the other two.
  const headers = new Headers(init.headers);
  if (authHeader.Authorization) {
    headers.set("Authorization", authHeader.Authorization);
  }
  // Skipped for FormData bodies: the browser needs to set its own multipart boundary in
  // Content-Type, which a force-set "application/json" would stomp on.
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });

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
