import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./lib/securityHeaders";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders({
          apiUrl: process.env.NEXT_PUBLIC_API_URL,
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          dev: process.env.NODE_ENV !== "production",
        }),
      },
    ];
  },
};

export default nextConfig;
