// Optional buyer username, shown to stores in chat instead of the buyer's name (developer
// decision 2026-10-31). Without one, stores see the buyer's first name only.
// Shared by the sign-up form (browser) and the Users collection (server).
export const CHAT_NAME_HINT = "3–30 letters or numbers (you can also use . _ -)";

// Names that could look like DigiMall staff or an official account
const RESERVED = ["admin", "digimall", "official", "support", "moderator", "staff"];

export const isValidChatName = (value: string): boolean => {
  const name = value.trim();
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(name)) return false;
  const lower = name.toLowerCase().replace(/[._-]/g, "");
  return !RESERVED.some((word) => lower.includes(word));
};

// What a store sees: the username, or else the first name only
export const buyerDisplayName = (user: { chatName?: string | null; name?: string | null }): string =>
  user.chatName?.trim() || user.name?.trim().split(/\s+/)[0] || "Buyer";
