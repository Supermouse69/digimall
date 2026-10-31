import type { CollectionConfig } from "payload";

import { isSuperAdmin, superAdminOnly } from "@/lib/access";
import { validateServiceBarangay } from "@/modules/settings/server/validators";

const wholePesos = (value: number | null | undefined) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000 ? true : "Whole pesos only (₱0 to ₱10,000).";

// Delivery fares from the rider organization's rate sheet (CLAUDE.md §11.11). Entered ONLY by the
// super-admin; never hardcoded. Base fare = first pickup store's barangay -> buyer's barangay, by mode.
// Extra stops: Settings -> "Delivery fee for each extra store stop".
export const Fares: CollectionConfig = {
  slug: "fares",
  access: {
    read: superAdminOnly,
    create: superAdminOnly,
    update: superAdminOnly,
    delete: superAdminOnly,
  },
  admin: {
    useAsTitle: "routeKey",
    defaultColumns: ["fromBarangay", "toBarangay", "casualFare", "fastFare"],
    hidden: ({ user }) => !isSuperAdmin(user),
    description: "One row per route (store's barangay -> buyer's barangay). Same barangay = one row with both the same.",
  },
  hooks: {
    beforeChange: [
      ({ data }) => ({ ...data, routeKey: `${String(data.fromBarangay ?? "").trim()} -> ${String(data.toBarangay ?? "").trim()}` }),
    ],
  },
  fields: [
    { name: "fromBarangay", label: "From (store's barangay)", type: "text", required: true, validate: validateServiceBarangay },
    { name: "toBarangay", label: "To (buyer's barangay)", type: "text", required: true, validate: validateServiceBarangay },
    { name: "casualFare", label: "Casual fare (₱)", type: "number", required: true, min: 0, validate: wholePesos },
    { name: "fastFare", label: "Fast fare (₱)", type: "number", required: true, min: 0, validate: wholePesos },
    { name: "routeKey", type: "text", unique: true, index: true, admin: { readOnly: true, description: "Filled in automatically." } },
  ],
};
