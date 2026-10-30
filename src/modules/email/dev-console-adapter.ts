import type { EmailAdapter } from "payload";

// DEVELOPMENT ONLY. Until a real email service (Resend) is connected, this prints each email's
// recipient, subject and LINKS to the terminal so the developer can click them while testing.
// Links contain one-time tokens, so this must never run in production (see payload.config.ts).

const extractLinks = (html: string): string[] =>
  [...html.matchAll(/href="([^"]+)"/g)]
    .map((match) => match[1]!.replace(/&amp;/g, "&"))
    .filter((href, index, all) => all.indexOf(href) === index);

export const devConsoleEmailAdapter: EmailAdapter = ({ payload }) => ({
  name: "dev-console",
  defaultFromAddress: "dev@localhost",
  defaultFromName: "DigiMall (dev)",
  sendEmail: async (message) => {
    const html = typeof message.html === "string" ? message.html : "";
    const links = extractLinks(html);
    payload.logger.info(
      [
        "📧 [DEV EMAIL - not really sent]",
        `   To:      ${String(message.to)}`,
        `   Subject: ${message.subject ?? ""}`,
        ...links.map((link) => `   Link:    ${link}`),
      ].join("\n"),
    );
    return { accepted: [message.to] };
  },
});
