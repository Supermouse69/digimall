import { generateTenantURL } from "@/lib/utils";
import type { SessionUser } from "@/modules/auth/server/procedures";

export interface AccountLink {
  href: string;
  label: string;
}

// Navbar links per role. These are shortcuts only — every page checks access on the server.
export const getAccountLinks = (user: SessionUser | null | undefined): AccountLink[] => {
  if (!user) {
    return [
      { href: "/login", label: "Log in" },
      { href: "/sign-up", label: "Sign up" },
    ];
  }
  switch (user.role) {
    case "seller":
      return [
        { href: "/admin", label: "Dashboard" },
        { href: "/seller/orders", label: "Orders" },
        ...(user.store ? [{ href: generateTenantURL(user.store.slug), label: "My store" }] : []),
      ];
    case "super-admin":
      return [{ href: "/admin", label: "Dashboard" }];
    case "rider":
      return [{ href: "/rider", label: "Rider portal" }];
    default:
      return [
        { href: "/orders", label: "My orders" },
        { href: "/cart", label: "Cart" },
      ];
  }
};
