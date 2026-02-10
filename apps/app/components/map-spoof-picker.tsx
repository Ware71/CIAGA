"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Plus, Minus, MapPin, Crosshair } from "lucide-react";

type LatLng = { lat: number; lng: number };

type Props = {
  initial?: LatLng | null;        // current spoof (if any)
  fallbackCenter?: LatLng | null; // e.g. last real known location
  onConfirm: (pos: LatLng) => void;
  onClear: () => void;
  onClose: () => void;
};

const TILE_SIZE = 256;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function wrapLng(lng: number) {
  // keep lng in [-180, 180)
  let x = ((lng + 180) % 360 + 360) % 360 - 180;
  // edge case: show 180 instead of -180 when appropriate
  if (x === -180) x = 180;
  return x;
}

/**
 * Minimal OSM map picker (no external deps)
 * Improvements:
 * - pin renders where clicked
 * - supports pointer panning (mouse + touch)
 * - supports wheel zoom
 * - avoids dropping pin after drag
 * - centers on initial / fallback / geolocation
 */
export default function MapSpoofPicker({
  initial,
  fallbackCenter,
  onConfirm,
  onClear,
  onClose,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState(13);
  const [center, setCenter] = useState<LatLng>(
    initial ?? fallbackCenter ?? { lat: 20, lng: 0 }
  );
  const [pin, setPin] = useState<LatLng | null>(initial ?? null);

  const pointerRef = useRef<{
    active: boolean;
    id: number | null;
    lastX: number;
    lastY: number;
    moved: boolean;
  }>({ active: false, id: null, lastX: 0, lastY: 0, moved: false });

  // ---------------- Web Mercator helpers ----------------
  function latLngToWorld({ lat, lng }: LatLng, z: number) {
    const sinLat = Math.sin((clamp(lat, -85, 85) * Math.PI) / 180);
    const scale = TILE_SIZE * Math.pow(2, z);
    return {
      x: ((wrapLng(lng) + 180) / 360) * scale,
      y:
        (0.5 -
          Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) *
        scale,
    };
  }

  function worldToLatLng(x: number, y: number, z: number): LatLng {
    const scale = TILE_SIZE * Math.pow(2, z);
    const lng = (x / scale) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * y) / scale;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return { lat: clamp(lat, -85, 85), lng: wrapLng(lng) };
  }

  function getRect() {
    return containerRef.current?.getBoundingClientRect() ?? null;
  }

  function clientToLatLng(clientX: number, clientY: number): LatLng | null {
    const rect = getRect();
    if (!rect) return null;

    const cx = rect.width / 2;
    const cy = rect.height / 2;

    const worldCenter = latLngToWorld(center, zoom);

    const dx = clientX - rect.left - cx;
    const dy = clientY - rect.top - cy;

    return worldToLatLng(worldCenter.x + dx, worldCenter.y + dy, zoom);
  }

  function latLngToClient(pos: LatLng): { x: number; y: number } | null {
    const rect = getRect();
    if (!rect) return null;

    const cx = rect.width / 2;
    const cy = rect.height / 2;

    const worldCenter = latLngToWorld(center, zoom);
    const worldPin = latLngToWorld(pos, zoom);

    return {
      x: rect.left + cx + (worldPin.x - worldCenter.x),
      y: rect.top + cy + (worldPin.y - worldCenter.y),
    };
  }

  // ---------------- Center on user (mount) ----------------
  useEffect(() => {
    // If we have initial or fallback, we’re good.
    if (initial || fallbackCenter) return;

    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setCenter({ lat: latitude, lng: longitude });
      },
      () => {
        // ignore - keep default
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }, [initial, fallbackCenter]);

  // If initial changes while open, update state (rare, but safe)
  useEffect(() => {
    if (initial) {
      setCenter(initial);
      setPin(initial);
    }
  }, [initial]);

  // ---------------- Pointer pan (mouse + touch) ----------------
  function onPointerDown(e: React.PointerEvent) {
    if (!containerRef.current) return;

    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);

    pointerRef.current.active = true;
    pointerRef.current.id = e.pointerId;
    pointerRef.current.lastX = e.clientX;
    pointerRef.current.lastY = e.clientY;
    pointerRef.current.moved = false;
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointerRef.current.active) return;
    if (pointerRef.current.id !== e.pointerId) return;

    const dx = pointerRef.current.lastX - e.clientX;
    const dy = pointerRef.current.lastY - e.clientY;

    // movement threshold to distinguish click vs drag
    if (!pointerRef.current.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      pointerRef.current.moved = true;
    }

    const world = latLngToWorld(center, zoom);
    const moved = worldToLatLng(world.x + dx, world.y + dy, zoom);

    setCenter(moved);

    pointerRef.current.lastX = e.clientX;
    pointerRef.current.lastY = e.clientY;
  }

  function onPointerUp(e: React.PointerEvent) {
    if (pointerRef.current.id !== e.pointerId) return;

    const wasDrag = pointerRef.current.moved;

    pointerRef.current.active = false;
    pointerRef.current.id = null;

    // If it wasn't a drag, treat as click to drop/move pin
    if (!wasDrag) {
      const ll = clientToLatLng(e.clientX, e.clientY);
      if (ll) setPin(ll);
    }
  }

  // ---------------- Wheel zoom ----------------
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY;

    // zoom around mouse pointer
    const rect = getRect();
    if (!rect) return;

    const before = clientToLatLng(e.clientX, e.clientY);
    const nextZoom = clamp(zoom + (delta > 0 ? -1 : 1), 2, 18);

    if (!before || nextZoom === zoom) {
      setZoom(nextZoom);
      return;
    }

    // Keep the lat/lng under the cursor stable after zoom
    // Approach: compute world coords of "before" at new zoom and adjust center accordingly.
    const afterWorld = latLngToWorld(before, nextZoom);

    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const dx = e.clientX - rect.left - cx;
    const dy = e.clientY - rect.top - cy;

    // We want: worldCenterNew + (dx,dy) = afterWorld  => worldCenterNew = afterWorld - (dx,dy)
    const worldCenterNew = { x: afterWorld.x - dx, y: afterWorld.y - dy };
    const centerNew = worldToLatLng(worldCenterNew.x, worldCenterNew.y, nextZoom);

    setZoom(nextZoom);
    setCenter(centerNew);
  }

  // ---------------- Tile rendering ----------------
  const tiles = useMemo(() => {
    const rect = getRect();
    if (!rect) return [];

    const tilesX = Math.ceil(rect.width / TILE_SIZE) + 2;
    const tilesY = Math.ceil(rect.height / TILE_SIZE) + 2;

    const worldCenter = latLngToWorld(center, zoom);

    const startX =
      Math.floor(worldCenter.x / TILE_SIZE) - Math.floor(tilesX / 2);
    const startY =
      Math.floor(worldCenter.y / TILE_SIZE) - Math.floor(tilesY / 2);

    const out: Array<{
      key: string;
      src: string;
      left: number;
      top: number;
    }> = [];

    for (let x = 0; x < tilesX; x++) {
      for (let y = 0; y < tilesY; y++) {
        const tx = startX + x;
        const ty = startY + y;

        const left = tx * TILE_SIZE - worldCenter.x + rect.width / 2;
        const top = ty * TILE_SIZE - worldCenter.y + rect.height / 2;

        // Wrap X for world repetition
        const max = Math.pow(2, zoom);
        const wrappedX = ((tx % max) + max) % max;

        // OSM has limited y range; skip tiles outside range
        if (ty < 0 || ty >= max) continue;

        out.push({
          key: `${zoom}-${wrappedX}-${ty}`,
          src: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${ty}.png`,
          left,
          top,
        });
      }
    }

    return out;
    // NOTE: depends on center/zoom and container size; container size stable while modal open
  }, [center, zoom]);

  // Compute pin screen position relative to container (for correct pin placement)
  const pinStyle = useMemo(() => {
    if (!pin) return null;
    const rect = getRect();
    if (!rect) return null;

    const worldCenter = latLngToWorld(center, zoom);
    const worldPin = latLngToWorld(pin, zoom);

    const x = rect.width / 2 + (worldPin.x - worldCenter.x);
    const y = rect.height / 2 + (worldPin.y - worldCenter.y);

    return { left: x, top: y };
  }, [pin, center, zoom]);

  function centerOnMe() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setCenter({ lat: latitude, lng: longitude });
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background w-[420px] rounded-lg shadow-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <div className="font-semibold text-sm flex items-center gap-2">
            <MapPin size={16} />
            Pick Nearby Location
          </div>
          <button onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Map */}
        <div
          ref={containerRef}
          className="relative h-[320px] bg-muted overflow-hidden touch-none"
          style={{ cursor: pointerRef.current.active ? "grabbing" : "grab" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {tiles.map((t) => (
            <img
              key={t.key}
              src={t.src}
              draggable={false}
              className="absolute select-none"
              style={{
                left: t.left,
                top: t.top,
                width: TILE_SIZE,
                height: TILE_SIZE,
              }}
              alt=""
            />
          ))}

          {/* Pin at clicked location */}
          {pinStyle && (
            <div
              className="absolute -translate-x-1/2 -translate-y-full text-red-600 pointer-events-none"
              style={{ left: pinStyle.left, top: pinStyle.top }}
            >
              <MapPin size={28} fill="currentColor" />
            </div>
          )}

          {/* Controls */}
          <div className="absolute right-2 top-2 flex flex-col gap-2">
            <div className="flex flex-col bg-background border rounded">
              <button
                className="p-1"
                onClick={() => setZoom((z) => clamp(z + 1, 2, 18))}
                aria-label="Zoom in"
              >
                <Plus size={14} />
              </button>
              <button
                className="p-1 border-t"
                onClick={() => setZoom((z) => clamp(z - 1, 2, 18))}
                aria-label="Zoom out"
              >
                <Minus size={14} />
              </button>
            </div>

            <button
              className="p-2 bg-background border rounded"
              onClick={centerOnMe}
              aria-label="Center on my location"
              title="Center on my location"
            >
              <Crosshair size={16} />
            </button>
          </div>

          {/* Hint */}
          <div className="absolute left-2 bottom-2 rounded bg-black/40 px-2 py-1 text-[10px] text-white/90">
            Drag to move • Scroll to zoom • Tap/click to drop pin
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t space-y-2">
          {/* coords preview */}
          <div className="text-[11px] text-muted-foreground">
            {pin
              ? `Selected: ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`
              : "Tap/click the map to choose a location."}
          </div>

          <div className="flex items-center justify-between">
            <button
              className="text-sm text-muted-foreground hover:text-foreground"
              onClick={() => {
                setPin(null);
                onClear();
              }}
            >
              Clear
            </button>

            <div className="flex gap-2">
              <button
                className="px-3 py-1 text-sm rounded border"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1 text-sm rounded bg-primary text-primary-foreground disabled:opacity-50"
                disabled={!pin}
                onClick={() => pin && onConfirm(pin)}
              >
                Use location
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
