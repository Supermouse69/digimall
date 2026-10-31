import type { PayloadRequest } from "payload";

import { fromPoint, isValidLatLng } from "@/lib/geo";

import { getSettings, isInServiceArea } from "./settings";

// Payload field validators shared by buyers' addresses and stores: both must be inside our
// service area (Settings), never a hardcoded list.

export const validateServiceBarangay = async (value: string | null | undefined, { req }: { req: PayloadRequest }) => {
  if (!value) return true;
  const { barangays } = await getSettings(req.payload);
  return barangays.includes(value) ? true : "Pick a barangay from our service area.";
};

export const validateServiceAreaPin = async (value: unknown, { req }: { req: PayloadRequest }) => {
  if (value === null || value === undefined) return true;
  const point = fromPoint(value as [number, number]);
  if (!isValidLatLng(point)) return "Invalid map pin.";
  const settings = await getSettings(req.payload);
  return isInServiceArea(settings, point) ? true : "This pin is outside our delivery area.";
};
