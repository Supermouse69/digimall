// Cloudflare Turnstile ("I'm not a robot" check). The browser gets a one-time token from
// Cloudflare; the server asks Cloudflare whether that token is real. Fails closed: no secret,
// no token, a network problem or a bad answer all mean "not verified".
// Development uses Cloudflare's official test keys (see .env.example).
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

let warnedMissingSecret = false;

export const verifyTurnstile = async (token: string, ip: string): Promise<boolean> => {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (!warnedMissingSecret) {
      console.error("TURNSTILE_SECRET_KEY is missing: every protected form will be refused.");
      warnedMissingSecret = true;
    }
    return false;
  }
  if (!token || token.length > 2048) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (ip !== "unknown") body.set("remoteip", ip);

  try {
    const response = await fetch(VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  }
};
