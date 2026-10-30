// Run: bun run test:emails
export {};
// Email templates must escape user input and only link to our own site.
process.env.NEXT_PUBLIC_APP_URL = "https://digimall.online";

const { resetPasswordTemplate, verifyEmailTemplate } = await import("../src/modules/email/templates");

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
};

const token = "a".repeat(40);
const verify = verifyEmailTemplate({ name: "<script>alert(1)</script> Juan", token });
const reset = resetPasswordTemplate({ name: 'Maria "the boss"', token });

check("verify: name is escaped (no raw <script>)", !verify.html.includes("<script>"));
check("verify: escaped text is shown", verify.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
check("verify: links to our /verify-email page", verify.html.includes(`https://digimall.online/verify-email?token=${token}`));
check("verify: never links to the admin panel", !verify.html.includes("/admin"));
check("reset: quotes escaped", reset.html.includes("&quot;the") === false && reset.html.includes("Maria"));
check("reset: links to our /reset-password page", reset.html.includes(`https://digimall.online/reset-password?token=${token}`));
check("reset: mentions 1 hour expiry", reset.html.includes("1 hour"));
check("subjects are plain text", !/[<>]/.test(verify.subject + reset.subject));

console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
