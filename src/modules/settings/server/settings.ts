import type { Payload } from "payload";

import {
  DEFAULT_BARANGAYS,
  DEFAULT_CHAT_RETENTION_DAYS,
  DEFAULT_MINIMUM_AGE,
  DEFAULT_SERVICE_CENTER,
  DEFAULT_SERVICE_RADIUS_KM,
} from "@/globals/Settings";
import { distanceKm, fromPoint, type LatLng } from "@/lib/geo";

export type MarketplaceSettings = {
  barangays: string[];
  serviceCenter: LatLng;
  serviceRadiusKm: number;
  minimumAge: number;
  signupKeyPoints: string;
  checkoutKeyPoints: string;
  chatRetentionDays: number;
};

// Reads the admin-editable settings, falling back to the defaults until the super-admin saves them.
export const getSettings = async (payload: Payload): Promise<MarketplaceSettings> => {
  const settings = await payload.findGlobal({ slug: "settings", depth: 0 }).catch(() => null);

  const barangays = (settings?.barangays ?? [])
    .map((row) => row?.name?.trim())
    .filter((name): name is string => Boolean(name));

  return {
    barangays: barangays.length > 0 ? barangays : DEFAULT_BARANGAYS,
    serviceCenter: fromPoint(settings?.serviceCenter as [number, number] | undefined) ?? DEFAULT_SERVICE_CENTER,
    serviceRadiusKm: settings?.serviceRadiusKm ?? DEFAULT_SERVICE_RADIUS_KM,
    minimumAge: settings?.minimumAge ?? DEFAULT_MINIMUM_AGE,
    signupKeyPoints: settings?.signupKeyPoints ?? "",
    checkoutKeyPoints: settings?.checkoutKeyPoints ?? "",
    chatRetentionDays: settings?.chatRetentionDays ?? DEFAULT_CHAT_RETENTION_DAYS,
  };
};

// Turns the Settings text box into a list: one point per line, without "*", "-" or "•" markers
export const toKeyPointList = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[*\-•]+\s*/, "").trim())
    .filter(Boolean);

export const isInServiceArea = (settings: MarketplaceSettings, point: LatLng): boolean =>
  distanceKm(settings.serviceCenter, point) <= settings.serviceRadiusKm;
