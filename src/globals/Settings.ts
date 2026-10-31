import type { GlobalConfig } from "payload";

import { superAdminOnly } from "@/lib/access";

// Admin-editable defaults (CLAUDE.md §11: never hardcode durations, limits, or the service area).
// The buyer site reads these through server code; there is no public REST access.
export const DEFAULT_BARANGAYS = ["San Marcos", "Balite", "Sergio Bayan", "Buguion"];

// Approximate center of Calumpit, Bulacan (used for the "is this pin in our area?" check)
export const DEFAULT_SERVICE_CENTER = { lat: 14.916, lng: 120.766 };
export const DEFAULT_SERVICE_RADIUS_KM = 8;
export const DEFAULT_MINIMUM_AGE = 18;

export const Settings: GlobalConfig = {
  slug: "settings",
  label: "Settings",
  access: {
    read: superAdminOnly,
    update: superAdminOnly,
  },
  admin: {
    description: "Marketplace settings. Only the super-admin can see or change these.",
  },
  fields: [
    {
      type: "collapsible",
      label: "Service area",
      fields: [
        {
          name: "barangays",
          label: "Barangays we deliver to",
          type: "array",
          required: true,
          minRows: 1,
          defaultValue: DEFAULT_BARANGAYS.map((name) => ({ name })),
          admin: {
            description: "Buyers pick one of these at sign-up. Removing one doesn't change existing accounts.",
          },
          fields: [{ name: "name", type: "text", required: true, maxLength: 60 }],
        },
        {
          name: "serviceCenter",
          label: "Service area center (for the map)",
          type: "point",
          required: true,
          defaultValue: [DEFAULT_SERVICE_CENTER.lng, DEFAULT_SERVICE_CENTER.lat],
          admin: {
            description: "Longitude, latitude. The sign-up map starts here.",
          },
        },
        {
          name: "serviceRadiusKm",
          label: "Max distance from the center (km)",
          type: "number",
          required: true,
          min: 1,
          max: 50,
          defaultValue: DEFAULT_SERVICE_RADIUS_KM,
          admin: {
            description: "A buyer's map pin must be within this straight-line distance.",
          },
        },
      ],
    },
    {
      type: "collapsible",
      label: "Sign-up",
      fields: [
        {
          name: "minimumAge",
          label: "Minimum age",
          type: "number",
          required: true,
          min: 1,
          max: 100,
          defaultValue: DEFAULT_MINIMUM_AGE,
          admin: {
            description: "Shown in the sign-up checkbox (\"I am at least __ years old\"). Must match your Terms.",
          },
        },
        {
          name: "signupKeyPoints",
          label: "Sign-up box: \"Before you join\"",
          type: "textarea",
          maxLength: 2000,
          defaultValue: "[Developer: write this]",
          admin: {
            description:
              "Shown on the sign-up page. One point per line (a leading * or - is fine). Cover: cancellation once 'On the way', delivery fee, refunds, paid-but-unbooked orders.",
          },
        },
        {
          name: "checkoutKeyPoints",
          label: "Checkout box: \"Quick reminders\"",
          type: "textarea",
          maxLength: 2000,
          defaultValue: "[Developer: write this]",
          admin: {
            description: "Shown at checkout (built in Phase 5). One point per line (a leading * or - is fine).",
          },
        },
      ],
    },
  ],
};
