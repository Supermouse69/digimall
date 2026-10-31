"use client";

import "leaflet/dist/leaflet.css";

import { MapContainer, Marker, TileLayer } from "react-leaflet";

import type { LatLng } from "@/lib/geo";

import { pinIcon } from "./pin-icon";

// Small read-only map with the store's pin (store pages). Loads OpenStreetMap tiles only when shown.
export const StoreMap = ({ point }: { point: LatLng }) => (
  <div className="h-48 w-full overflow-hidden rounded-md border">
    <MapContainer
      center={[point.lat, point.lng]}
      zoom={16}
      scrollWheelZoom={false}
      dragging={false}
      className="h-full w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <Marker position={[point.lat, point.lng]} icon={pinIcon} />
    </MapContainer>
  </div>
);

export default StoreMap;
