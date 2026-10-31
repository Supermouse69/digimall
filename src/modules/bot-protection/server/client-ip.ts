// The visitor's IP address, used only as a rate-limit key (stored hashed, never as plain text).
// On Vercel these headers are set by Vercel itself, so visitors can't fake them.
// Locally they can be missing, so every local request shares the "unknown" bucket.
export const clientIp = (headers: Headers): string =>
  headers.get("x-real-ip")?.trim() || headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
