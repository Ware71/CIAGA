"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Row } from "@/components/ui/chrome";
import { cn } from "@/lib/utils";

/**
 * Choose a tee, the same way you choose a course — a sheet, not a row of chips.
 *
 * A course commonly carries a dozen or more tees: every colour, in men's and
 * women's ratings, and each 18-hole tee also appears as a synthetic "(Front 9)"
 * and "(Back 9)" pair created during import. Laid out flat that is a wall of
 * near-identical names, so this filters by gender and hole count first.
 */

export type TeeOption = {
  id: string;
  name: string | null;
  gender: string | null;
  rating: number | null;
  slope: number | null;
  par: number | null;
  yards: number | null;
  holes_count: number | null;
  holes?: unknown[];
};

export type Gender = "male" | "female" | "unisex";

/** Import writes several spellings; fold them to the three we filter on. */
export function normalizeGender(g: string | null | undefined): Gender {
  const s = (g ?? "").toLowerCase().trim();
  if (["male", "men", "m", "mens", "men's"].includes(s)) return "male";
  if (["female", "women", "w", "f", "ladies", "lady", "womens", "women's"].includes(s)) {
    return "female";
  }
  return "unisex";
}

/**
 * How many holes a tee plays.
 *
 * `holes_count` is authoritative when set, then the actual hole rows, and the
 * name is the last resort — the "(Front 9)" / "(Back 9)" rows that `resolve`
 * synthesises are the reason a name check is needed at all.
 */
export function teeHolesCount(t: TeeOption): number {
  if (t.holes_count === 9 || t.holes_count === 18) return t.holes_count;
  const holes = Array.isArray(t.holes) ? t.holes.length : 0;
  if (holes === 9 || holes === 18) return holes;
  const n = (t.name ?? "").toLowerCase();
  if (n.includes("(front 9)") || n.includes("(back 9)")) return 9;
  return 18;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "rounded-full px-3 py-1.5 text-[length:var(--t-sec)] transition-colors",
        on
          ? "bg-[color:var(--sec-accent)] font-medium text-[color:var(--ciaga-ground)]"
          : "border border-[color:var(--sec-hair)] text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text)]"
      )}
    >
      {children}
    </button>
  );
}

export function TeePickerSheet({
  tees,
  selectedId,
  onSelect,
  onClose,
  courseName,
}: {
  tees: TeeOption[];
  selectedId: string | null;
  onSelect: (tee: TeeOption) => void;
  onClose: () => void;
  courseName?: string | null;
}) {
  const [gender, setGender] = useState<"all" | Gender>("all");
  const [holes, setHoles] = useState<"all" | 18 | 9>(18);

  // Only offer a filter the course actually has tees for — a men's-only course
  // shouldn't show an empty "Women's" tab.
  const available = useMemo(() => {
    const g = new Set<Gender>();
    const h = new Set<number>();
    for (const t of tees) {
      g.add(normalizeGender(t.gender));
      h.add(teeHolesCount(t));
    }
    return { genders: g, holes: h };
  }, [tees]);

  const shown = useMemo(() => {
    return tees.filter((t) => {
      // Unisex tees belong under both men's and women's, not only under "All".
      if (gender !== "all") {
        const g = normalizeGender(t.gender);
        if (g !== gender && g !== "unisex") return false;
      }
      if (holes !== "all" && teeHolesCount(t) !== holes) return false;
      return true;
    });
  }, [tees, gender, holes]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[color:var(--ciaga-ground)]">
      <div className="mx-auto flex min-h-0 w-full max-w-sm flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6">
        <header className="flex shrink-0 items-start justify-between gap-2 pb-3">
          <div className="min-w-0">
            <h2 className="text-[length:var(--t-fig)] font-semibold text-[color:var(--sec-text)]">
              Select tee
            </h2>
            {courseName ? (
              <p className="truncate text-[length:var(--t-sec)] text-[color:var(--sec-muted)]">
                {courseName}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[color:var(--sec-muted)] transition-colors hover:bg-[color:var(--sec-surface)] hover:text-[color:var(--sec-text)]"
          >
            <X size={20} />
          </button>
        </header>

        <div className="flex shrink-0 flex-wrap gap-1.5 pb-2">
          <Chip on={gender === "all"} onClick={() => setGender("all")}>
            All
          </Chip>
          {available.genders.has("male") || available.genders.has("unisex") ? (
            <Chip on={gender === "male"} onClick={() => setGender("male")}>
              Men's
            </Chip>
          ) : null}
          {available.genders.has("female") || available.genders.has("unisex") ? (
            <Chip on={gender === "female"} onClick={() => setGender("female")}>
              Women's
            </Chip>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap gap-1.5 pb-3">
          {available.holes.has(18) ? (
            <Chip on={holes === 18} onClick={() => setHoles(18)}>
              18 holes
            </Chip>
          ) : null}
          {available.holes.has(9) ? (
            <Chip on={holes === 9} onClick={() => setHoles(9)}>
              9 holes
            </Chip>
          ) : null}
          <Chip on={holes === "all"} onClick={() => setHoles("all")}>
            Any
          </Chip>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {shown.length === 0 ? (
            <p className="py-6 text-center text-[length:var(--t-body)] text-[color:var(--sec-muted)]">
              No tees match those filters.
            </p>
          ) : (
            shown.map((t) => {
              const r = num(t.rating);
              const s = num(t.slope);
              const p = num(t.par);
              const y = num(t.yards);
              const meta = [
                r !== null ? `CR ${r.toFixed(1)}` : null,
                s !== null ? `SL ${s}` : null,
                p !== null ? `Par ${p}` : null,
                y !== null && y > 0 ? `${y} yds` : null,
              ]
                .filter(Boolean)
                .join(" · ");

              return (
                <Row
                  key={t.id}
                  onClick={() => onSelect(t)}
                  title={t.name ?? "Tee"}
                  subtitle={meta || undefined}
                  trailing={
                    t.id === selectedId ? (
                      <span className="text-[length:var(--t-sec)] font-medium text-[color:var(--sec-accent)]">
                        Selected
                      </span>
                    ) : (
                      <span className="text-[length:var(--t-fig)] leading-none text-[color:var(--sec-muted)]">
                        ›
                      </span>
                    )
                  }
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default TeePickerSheet;
