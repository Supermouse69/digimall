"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { LocateFixedIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { LatLng } from "@/lib/geo";

import { pinIcon } from "./pin-icon";


interface Props {
  center: LatLng;
  radiusKm: number;
  value: LatLng | null;
  onChange: (point: LatLng) => void;
}

const ClickToPlace = ({ onChange }: { onChange: Props["onChange"] }) => {
  useMapEvents({
    click: (event) => onChange({ lat: event.latlng.lat, lng: event.latlng.lng }),
  });
  return null;
};

const FlyTo = ({ point }: { point: LatLng | null }) => {
  const map = useMap();
  useEffect(() => {
    if (point) map.flyTo([point.lat, point.lng], Math.max(map.getZoom(), 17), { duration: 0.6 });
  }, [map, point]);
  return null;
};

// Buyers drop a pin where we should deliver. No address search (CLAUDE.md §11.13).
export const LocationPicker = ({ center, radiusKm, value, onChange }: Props) => {
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [flyTarget, setFlyTarget] = useState<LatLng | null>(null);

  const markerHandlers = useMemo(
    () => ({
      dragend: (event: L.LeafletEvent) => {
        const { lat, lng } = (event.target as L.Marker).getLatLng();
        onChange({ lat, lng });
      },
    }),
    [onChange],
  );

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) {
      setLocateError("Your browser can't share its location. Tap the map instead.");
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        setLocating(false);
        setFlyTarget(point);
        onChange(point);
      },
      () => {
        setLocating(false);
        setLocateError("Couldn't get your location. Tap the map to place the pin instead.");
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="h-72 w-full overflow-hidden rounded-md border">
        <MapContainer
          center={[value?.lat ?? center.lat, value?.lng ?? center.lng]}
          zoom={value ? 17 : 14}
          scrollWheelZoom={false}
          className="h-full w-full"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
          <Circle
            center={[center.lat, center.lng]}
            radius={radiusKm * 1000}
            pathOptions={{ color: "#16a34a", weight: 1, fillOpacity: 0.05 }}
          />
          <ClickToPlace onChange={onChange} />
          <FlyTo point={flyTarget} />
          {value && (
            <Marker
              position={[value.lat, value.lng]}
              icon={pinIcon}
              draggable
              eventHandlers={markerHandlers}
            />
          )}
        </MapContainer>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={useMyLocation} disabled={locating}>
          <LocateFixedIcon />
          {locating ? "Finding you..." : "Use my location"}
        </Button>
        <span className="text-sm text-neutral-600">
          {value ? "Pin placed. Drag it to adjust." : "Tap the map to place your pin."}
        </span>
      </div>
      {locateError && <p className="text-sm text-destructive">{locateError}</p>}
    </div>
  );
};

export default LocationPicker;
