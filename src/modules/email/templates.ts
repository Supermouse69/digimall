// Transactional emails only (CLAUDE.md §11.12). Plain, light HTML that works in phone mail apps.
// Every value from users is escaped so nobody can inject HTML into an email.

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Links in emails always point at our own site
export const appUrl = (path: string): string => {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
};

const firstName = (name: unknown) =>
  typeof name === "string" && name.trim() ? name.trim().split(/\s+/)[0]! : "there";

type EmailParts = { heading: string; intro: string; buttonLabel: string; url: string; footer: string };

const layout = ({ heading, intro, buttonLabel, url, footer }: EmailParts): string => `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f4f4f0;font-family:Arial,Helvetica,sans-serif;color:#111">
    <div style="max-width:480px;margin:0 auto;padding:24px 16px">
      <p style="font-size:22px;font-weight:700;margin:0 0 16px">DigiMall</p>
      <div style="background:#fff;border:1px solid #ddd;border-radius:8px;padding:24px">
        <h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(heading)}</h1>
        <p style="font-size:16px;line-height:1.5;margin:0 0 20px">${escapeHtml(intro)}</p>
        <a href="${escapeHtml(url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:16px">${escapeHtml(buttonLabel)}</a>
        <p style="font-size:13px;line-height:1.5;color:#555;margin:20px 0 0">If the button doesn't work, copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(url)}</span></p>
      </div>
      <p style="font-size:12px;line-height:1.5;color:#777;margin:16px 0 0">${escapeHtml(footer)}</p>
    </div>
  </body>
</html>`;

export const verifyEmailTemplate = ({ name, token }: { name?: unknown; token: string }) => ({
  subject: "Confirm your DigiMall email",
  html: layout({
    heading: `Hi ${firstName(name)}, please confirm your email`,
    intro: "Tap the button below to confirm this is your email address. Then you can log in and start shopping.",
    buttonLabel: "Confirm my email",
    url: appUrl(`/verify-email?token=${encodeURIComponent(token)}`),
    footer: "If you didn't create a DigiMall account, you can ignore this email.",
  }),
});

export const resetPasswordTemplate = ({ name, token }: { name?: unknown; token: string }) => ({
  subject: "Reset your DigiMall password",
  html: layout({
    heading: `Hi ${firstName(name)}, reset your password`,
    intro: "Someone (hopefully you) asked to reset your DigiMall password. This link works for 1 hour.",
    buttonLabel: "Choose a new password",
    url: appUrl(`/reset-password?token=${encodeURIComponent(token)}`),
    footer: "If you didn't ask for this, ignore this email. Your password stays the same.",
  }),
});
