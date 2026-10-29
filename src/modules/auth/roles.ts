// Shared by the server (Payload, tRPC) and the browser (navbar), so no server-only imports here.

export const USER_ROLES = ["buyer", "seller", "rider", "super-admin"] as const;

export type UserRole = (typeof USER_ROLES)[number];

// Only allow redirects to our own pages ("/x"), never to other sites ("//evil.com", "https://...").
// Browsers treat "\" like "/" and silently drop tabs/newlines, so those are rejected too.
const UNSAFE_CHARS = /[\\\u0000-\u001F\u007F]/;
const LOCAL_ORIGIN = "http://local.invalid";

export const safeRedirectPath = (path: string | null | undefined, fallback = "/"): string => {
  if (!path || !path.startsWith("/") || path.startsWith("//") || UNSAFE_CHARS.test(path)) {
    return fallback;
  }
  try {
    const url = new URL(path, LOCAL_ORIGIN);
    if (url.origin !== LOCAL_ORIGIN) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
};

// Where each role lands after logging in. Buyers go back to the page they came from.
export const homeForRole = (role: UserRole | null | undefined, next?: string | null): string => {
  switch (role) {
    case "seller":
    case "super-admin":
      return "/admin";
    case "rider":
      return "/rider";
    default:
      return safeRedirectPath(next);
  }
};
