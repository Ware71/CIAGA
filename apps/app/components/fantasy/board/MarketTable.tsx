"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import type { Cell, MarketTableModel } from "@/lib/fantasy/board/groupBoard";

/**
 * Players-as-rows × labelled-odds-columns grid (Finishes, Birdies, Eagles).
 * Horizontally scrollable so it never widens the max-w-sm board. The parent
 * supplies `renderCell` so the pill keeps its slip / flash / lock state, and
 * an optional `onPlayer` to open the player stats sheet from the name.
 */
export function MarketTable({
  model,
  renderCell,
  onPlayer,
}: {
  model: MarketTableModel;
  renderCell: (cell: Cell) => ReactNode;
  onPlayer?: (profileId: string) => void;
}) {
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="sticky left-0 bg-[color:var(--sec-surface)] px-1.5 py-1 text-left text-[9px] font-semibold uppercase tracking-wider text-[color:var(--sec-muted)]" />
            {model.columns.map((c) => (
              <th
                key={c.id}
                className="px-1 py-1 text-center text-[9px] font-semibold uppercase tracking-wider text-[color:var(--sec-muted)] whitespace-nowrap"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <tr key={row.profileId} className="border-t border-[color:var(--sec-hair)]">
              <td className="sticky left-0 bg-[color:color-mix(in_srgb,var(--sec-surface)_95%,transparent)] px-1.5 py-1 max-w-[120px]">
                <button
                  type="button"
                  disabled={!onPlayer}
                  onClick={() => onPlayer?.(row.profileId)}
                  className="flex items-center gap-1 text-[12px] text-[color:var(--sec-muted)] disabled:cursor-default"
                >
                  <span className="truncate">{row.name}</span>
                  {onPlayer && <Info className="h-3 w-3 shrink-0 text-[color:var(--sec-muted)]" />}
                </button>
              </td>
              {row.cells.map((cell, i) => (
                <td key={model.columns[i]?.id ?? i} className="px-1 py-1 text-center">
                  {renderCell(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
