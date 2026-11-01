"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from "react-leaflet";

import type { LatLng } from "@/lib/geo";

// Trip map: store stops, the delivery pin and the rider (rider portal + buyer's order page).
// Only shown during an active trip (CLAUDE.md §11.7: no live map before booking).

const dot = (color: string, label: string) =>
  L.divIcon({
    className: "",
    html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-size:14px">${label}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

const STORE_ICON = dot("#111", "🏪");
const HOME_ICON = dot("#ec4899", "🏠");
const RIDER_ICON = dot("#16a34a", "🛺");

export type TripPoint = { point: LatLng; label: string };

const FitAll = ({ points }: { points: LatLng[] }) => {
  const map = useMap();
  const key = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("|");
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) map.setView([points[0]!.lat, points[0]!.lng], 16);
    else map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [30, 30], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when the points really move
  }, [map, key]);
  return null;
};

interface Props {
  stores: TripPoint[];
  home?: TripPoint | null;
  rider?: TripPoint | null;
  className?: string;
}

export const TripMap = ({ stores, home, rider, className }: Props) => {
  const all = [...stores.map((s) => s.point), ...(home ? [home.point] : []), ...(rider ? [rider.point] : [])];
  const start = all[0] ?? { lat: 14.916, lng: 120.766 };
  return (
    <div className={className ?? "h-64 w-full overflow-hidden rounded-md border"}>
      <MapContainer center={[start.lat, start.lng]} zoom={15} scrollWheelZoom={false} className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        {stores.map((store) => (
          <Marker key={`${store.label}-${store.point.lat}`} position={[store.point.lat, store.point.lng]} icon={STORE_ICON}>
            <Tooltip>{store.label}</Tooltip>
          </Marker>
        ))}
        {home && (
          <Marker position={[home.point.lat, home.point.lng]} icon={HOME_ICON}>
            <Tooltip>{home.label}</Tooltip>
          </Marker>
        )}
        {rider && (
          <Marker position={[rider.point.lat, rider.point.lng]} icon={RIDER_ICON}>
            <Tooltip>{rider.label}</Tooltip>
          </Marker>
        )}
        <FitAll points={all} />
      </MapContainer>
    </div>
  );
};

export default TripMap;
