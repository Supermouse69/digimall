// Straight-line distances (beta: "approx." only, no road routing — CLAUDE.md §11.13)

export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_KM = 6371;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export const distanceKm = (a: LatLng, b: LatLng): number => {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
};

export const isValidLatLng = (value: unknown): value is LatLng => {
  const point = value as LatLng | null;
  return (
    !!point &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lng) <= 180
  );
};

// Payload "point" fields store [longitude, latitude]
export const toPoint = ({ lat, lng }: LatLng): [number, number] => [lng, lat];
export const fromPoint = (point: [number, number] | null | undefined): LatLng | null =>
  point ? { lat: point[1], lng: point[0] } : null;
