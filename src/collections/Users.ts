import type { CollectionConfig } from 'payload'
import { tenantsArrayField } from "@payloadcms/plugin-multi-tenant/fields";

import {
  hasTenant,
  isSuperAdmin,
  superAdminOnly,
  superAdminOnlyField,
  superAdminOrSelf,
} from "@/lib/access";

// Only the super-admin can attach a user to a store.
const defaultTenantArrayField = tenantsArrayField({
  tenantsArrayFieldName: "tenants",
  tenantsCollectionSlug: "tenants",
  tenantsArrayTenantFieldName: "tenant",
  arrayFieldAccess: {
    read: () => true,
    create: superAdminOnlyField,
    update: superAdminOnlyField,
  },
  tenantFieldAccess: {
    read: () => true,
    create: superAdminOnlyField,
    update: superAdminOnlyField,
  },
})

export const Users: CollectionConfig = {
  slug: 'users',
  access: {
    // Payload admin panel: store owners and the super-admin only
    admin: ({ req }) => isSuperAdmin(req.user) || hasTenant(req.user),
    read: superAdminOrSelf,
    // Public sign-up goes through our own server code (tRPC), not the REST API
    create: superAdminOnly,
    update: superAdminOrSelf,
    delete: superAdminOnly,
  },
  admin: {
    useAsTitle: 'email',
    hidden: ({ user }) => !isSuperAdmin(user),
  },
  auth: {
    cookies: {
      sameSite: "Lax",
      secure: process.env.NODE_ENV === "production",
    },
  },
  fields: [
    {
      name: "username",
      required: true,
      unique: true,
      type: "text",
    },
    {
      admin: {
        position: "sidebar",
      },
      name: "roles",
      type: "select",
      defaultValue: ["user"],
      hasMany: true,
      options: ["super-admin", "user"],
      access: {
        create: superAdminOnlyField,
        update: superAdminOnlyField,
      },
    },
    {
      ...defaultTenantArrayField,
      admin: {
        ...(defaultTenantArrayField?.admin || {}),
        position: "sidebar",
      },
    },
  ],
};
