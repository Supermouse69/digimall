import "server-only";

import { redirect } from "next/navigation";
import { headers as getHeaders } from "next/headers";
import { getPayload } from "payload";
import config from "@payload-config";

import type { User } from "@/payload-types";
import type { UserRole } from "../roles";

// For pages: the logged-in user with one of `roles`, else off to log in (or home).
// Only a convenience for pages; every procedure checks again on its own.
export const requireUser = async (roles: UserRole[], nextPath: string): Promise<User> => {
  const payload = await getPayload({ config });
  const { user } = await payload.auth({ headers: await getHeaders() });
  if (!user || user.collection !== "users") redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (!roles.includes((user as User).role)) redirect("/");
  return user as User;
};
