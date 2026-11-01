import { withPayload } from "@payloadcms/next/withPayload";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Security headers (CLAUDE.md §10.9). The CSP lists only what the site really uses:
// - Cloudflare Turnstile (robot check): script + frame from challenges.cloudflare.com
// - OpenStreetMap tiles (maps) and Vercel Blob (public product photos) for images
// - frame-ancestors 'self' (not 'none'): the seller's chat/orders bubbles in the Payload admin
//   show our own pages in a frame. Other sites still can't frame us.
// 'unsafe-inline' scripts are needed by Next.js/Payload without per-request nonces; 'unsafe-eval'
// only in development (hot reload).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.public.blob.vercel-storage.com",
  "font-src 'self' data:",
  `connect-src 'self' https://challenges.cloudflare.com${isDev ? " ws: wss:" : ""}`,
  "frame-src 'self' https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  // Only on Vercel (https): locally a production build runs on plain http
  ...(process.env.VERCEL === "1" ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Location (riders, map pins) and camera (photo uploads) for our own site only
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(self), microphone=(), payment=(), usb=()" },
  // HTTPS only (sent by browsers only over https, so it doesn't affect localhost)
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  images: {
    // Public product photos/logos live on Vercel Blob in production
    remotePatterns: [{ protocol: "https", hostname: "*.public.blob.vercel-storage.com" }],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The service worker must always be fresh (push notifications)
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
    ];
  },
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
