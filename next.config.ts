import { withPayload } from "@payloadcms/next/withPayload";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Old tutorial path; the shared login page is /login (CLAUDE.md §7)
      { source: "/sign-in", destination: "/login", permanent: true },
      // Store pages moved from the tutorial's /tenants/<slug> to /store/<slug> (Phase 3)
      { source: "/tenants/:path*", destination: "/store/:path*", permanent: true },
    ];
  },
};

export default withPayload(nextConfig);
