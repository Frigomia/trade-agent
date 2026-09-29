import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth cookie if the access token has expired, so Server Components
 * (which can't write cookies themselves — see lib/supabase/server.ts's try/catch) always see a
 * valid session. This does not redirect or protect any route by itself — see
 * app/(shell)/layout.tsx and app/(shell)/admin/layout.tsx for the actual route protection,
 * which runs server-side, after this.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Triggers a token refresh if the current access token is expired; the setAll callback above
  // then writes the refreshed cookie onto the response.
  await supabase.auth.getUser();

  return response;
}
