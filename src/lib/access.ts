import type { Access, ClientUser, FieldAccess, Where } from "payload";

import type { User } from "@/payload-types";

// Deny by default: every collection uses these helpers instead of Payload's
// built-in default ("any logged-in user can do anything").

type AnyUser = User | ClientUser | null | undefined;

export const isSuperAdmin = (user: AnyUser): boolean =>
  Boolean(user?.roles?.includes("super-admin"));

// IDs of the stores (tenants) this user belongs to.
export const getUserTenantIds = (user: AnyUser): string[] =>
  (user?.tenants ?? [])
    .map((row: { tenant?: unknown }) => {
      const tenant = row?.tenant;
      if (typeof tenant === "string") return tenant;
      if (tenant && typeof tenant === "object" && "id" in tenant) return String(tenant.id);
      return null;
    })
    .filter((id: string | null): id is string => Boolean(id));

export const hasTenant = (user: AnyUser): boolean => getUserTenantIds(user).length > 0;

export const anyone: Access = () => true;

export const superAdminOnly: Access = ({ req }) => isSuperAdmin(req.user);

export const superAdminOnlyField: FieldAccess = ({ req }) => isSuperAdmin(req.user);

// Super-admin: everything. Logged-in user: only their own user document.
export const superAdminOrSelf: Access = ({ req }) => {
  if (isSuperAdmin(req.user)) return true;
  if (!req.user) return false;
  return { id: { equals: req.user.id } } satisfies Where;
};

// Super-admin: everything. Store member: only docs whose `field` points to one of their stores.
export const superAdminOrOwnTenant =
  (field: "id" | "tenant"): Access =>
  ({ req }) => {
    if (isSuperAdmin(req.user)) return true;
    const tenantIds = getUserTenantIds(req.user);
    if (tenantIds.length === 0) return false;
    return { [field]: { in: tenantIds } } satisfies Where;
  };

export const superAdminOrStoreMember: Access = ({ req }) =>
  isSuperAdmin(req.user) || hasTenant(req.user);
