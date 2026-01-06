"use client";

import { useEffect, useRef, useState } from "react";
import { X, Plus, Minus, MapPin } from "lucide-react";

type LatLng = { lat: number; lng: number };

type Props = {
  initial?: LatLng | null;
  onConfirm: (pos: LatLng) => void;
  onClear: () => void;
  onClose: () => void;
};

const TILE_SIZE = 256;

/**
 * Minimal OSM map picker (no external deps)
 * - Click map to drop pin
 * - Zoom + pan
 * - Converts pixel → lat/lng correctly (Web Mercator)
 */
export default function MapSpoofPicker({
  initial,
  onConfirm,
  onClear,
  onClose,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState(3);
  const [center, setCenter] = useState<LatLng>(
    initial ?? { lat: 20, lng: 0 }
  );
  const [pin, setPin] = useState<LatLng | null>(initial ?? null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null
  );

  /* ---------------- Web Mercator helpers ---------------- */

  function latLngToWorld({ lat, lng }: LatLng, z: number) {
    const sinLat = Math.sin((lat * Math.PI) / 180);
    const scale = TILE_SIZE * Math.pow(2, z);

    return {
      x: ((lng + 180) / 360) * scale,
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

    return { lat, lng };
  }

  /* ---------------- Interaction ---------------- */

  function handleClick(e: React.MouseEvent) {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    const worldCenter = latLngToWorld(center, zoom);
    const clickWorld = {
      x: worldCenter.x + (e.clientX - rect.left - cx),
      y: worldCenter.y + (e.clientY - rect.top - cy),
    };

    setPin(worldToLatLng(clickWorld.x, clickWorld.y, zoom));
  }

  function onMouseDown(e: React.MouseEvent) {
    setDragStart({ x: e.clientX, y: e.clientY });
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!dragStart || !containerRef.current) return;

    const dx = dragStart.x - e.clientX;
    const dy = dragStart.y - e.clientY;

    const world = latLngToWorld(center, zoom);
    const moved = worldToLatLng(world.x + dx, world.y + dy, zoom);

    setCenter(moved);
    setDragStart({ x: e.clientX, y: e.clientY });
  }

  function onMouseUp() {
    setDragStart(null);
  }

  /* ---------------- Tile rendering ---------------- */

  function renderTiles() {
    if (!containerRef.current) return null;

    const rect = containerRef.current.getBoundingClientRect();
    const tilesX = Math.ceil(rect.width / TILE_SIZE) + 2;
    const tilesY = Math.ceil(rect.height / TILE_SIZE) + 2;

    const worldCenter = latLngToWorld(center, zoom);

    const startX =
      Math.floor(worldCenter.x / TILE_SIZE) - Math.floor(tilesX / 2);
    const startY =
      Math.floor(worldCenter.y / TILE_SIZE) - Math.floor(tilesY / 2);

    const tiles = [];

    for (let x = 0; x < tilesX; x++) {
      for (let y = 0; y < tilesY; y++) {
        const tx = startX + x;
        const ty = startY + y;

        const left =
          tx * TILE_SIZE -
          worldCenter.x +
          rect.width / 2;
        const top =
          ty * TILE_SIZE -
          worldCenter.y +
          rect.height / 2;

        tiles.push(
          <img
            key={`${tx}-${ty}`}
            src={`https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`}
            draggable={false}
            className="absolute select-none"
            style={{
              left,
              top,
              width: TILE_SIZE,
              height: TILE_SIZE,
            }}
          />
        );
      }
    }

    return tiles;
  }

  /* ---------------- Render ---------------- */

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background w-[420px] rounded-lg shadow-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <div className="font-semibold text-sm flex items-center gap-2">
            <MapPin size={16} />
            Pick Nearby Location
          </div>
          <button onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Map */}
        <div
          ref={containerRef}
          className="relative h-[300px] bg-muted cursor-grab overflow-hidden"
          onClick={handleClick}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          {renderTiles()}

          {/* Pin */}
          {pin && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full text-red-600 pointer-events-none">
              <MapPin size={28} fill="currentColor" />
            </div>
          )}

          {/* Zoom */}
          <div className="absolute right-2 top-2 flex flex-col bg-background border rounded">
            <button
              className="p-1"
              onClick={() => setZoom((z) => Math.min(z + 1, 18))}
            >
              <Plus size={14} />
            </button>
            <button
              className="p-1 border-t"
              onClick={() => setZoom((z) => Math.max(z - 1, 1))}
            >
              <Minus size={14} />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t">
          <button
            className="text-sm text-muted-foreground"
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
  );
}
