// Philippine mobile numbers: 09XXXXXXXXX or +639XXXXXXXXX (CLAUDE.md §16).
// Stored in one format (+639XXXXXXXXX) so the same number can't be saved two ways.

const PH_MOBILE = /^(?:09|\+639)\d{9}$/;

export const PH_MOBILE_HINT = "Use 09XXXXXXXXX or +639XXXXXXXXX";

const stripSpaces = (value: string) => value.replace(/[\s-]/g, "");

export const isPhMobile = (value: string): boolean => PH_MOBILE.test(stripSpaces(value));

export const normalizePhMobile = (value: string): string => {
  const compact = stripSpaces(value);
  return compact.startsWith("09") ? `+63${compact.slice(1)}` : compact;
};
