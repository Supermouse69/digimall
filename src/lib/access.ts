import type { Access, ClientUser, FieldAccess, Where } from "payload";

import type { User } from "@/payload-types";
import type { UserRole } from "@/modules/auth/roles";

// Deny by default: every collection uses these helpers instead of Payload's
// built-in default ("any logged-in user can do anything").

type AnyUser = User | ClientUser | null | undefined;

export const getRole = (user: AnyUser): UserRole | null =>
  (user as { role?: UserRole } | null | undefined)?.role ?? null;

export const isSuperAdmin = (user: AnyUser): boolean => getRole(user) === "super-admin";
export const isSeller = (user: AnyUser): boolean => getRole(user) === "seller";
export const isRider = (user: AnyUser): boolean => getRole(user) === "rider";
export const isBuyer = (user: AnyUser): boolean => getRole(user) === "buyer";

// Payload admin panel: sellers (their own store) and the super-admin (everything)
export const canUseAdminPanel = (user: AnyUser): boolean => isSuperAdmin(user) || isSeller(user);

// IDs of the stores (tenants) a seller manages. Other roles never manage a store.
export const getUserTenantIds = (user: AnyUser): string[] => {
  if (!isSeller(user)) return [];
  return ((user as { tenants?: { tenant?: unknown }[] | null })?.tenants ?? [])
    .map((row) => {
      const tenant = row?.tenant;
      if (typeof tenant === "string") return tenant;
      if (tenant && typeof tenant === "object" && "id" in tenant) return String(tenant.id);
      return null;
    })
    .filter((id): id is string => Boolean(id));
};

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

// Super-admin: everything. Seller: only docs whose `field` points to one of their stores.
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

// Store fields only the store's own seller and the super-admin may see (phone, GCash QR, documents).
// Used as field-level READ access on the tenants collection, so they never reach the public API.
export const superAdminOrOwnStoreField: FieldAccess = ({ req, doc, id }) => {
  if (isSuperAdmin(req.user)) return true;
  const storeId = (doc as { id?: unknown } | undefined)?.id ?? id;
  return storeId !== undefined && getUserTenantIds(req.user).includes(String(storeId));
};

// Store statuses buyers can see. Pending and suspended stores are hidden everywhere public.
export const PUBLIC_STORE_STATUSES = ["unverified", "verified"] as const;
