import Image from "next/image";
import { IconBell } from "./icons";

/**
 * CSS recreations of app screens, for the marketing page.
 *
 * These deliberately use the *literal* classNames from apps/app rather than
 * named utilities, so the two stay visually locked and markup can be moved
 * between them. They are a snapshot, not a live mirror — a palette change in
 * apps/app is a find-and-replace here too.
 *
 * All data is invented. Everything renders inside PhoneFrame, which is
 * aria-hidden internally, so the low-opacity tints the app uses for dense data
 * (/50-/65) are fine here — they're artwork, not content.
 */

function Rule() {
  return <div className="my-3 h-px bg-emerald-900/35" />;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-emerald-100/45">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-extrabold text-emerald-50">{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ home -- */

export function MockHome() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-full border border-[#0a341c]/40 bg-[#0a341c]/70">
            <Image
              src="/ciaga-logo-96.png"
              alt=""
              width={36}
              height={36}
              className="rounded-full object-contain"
            />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-wide text-[#f5e6b0]">
              CIAGA
            </span>
            <span className="text-[9px] uppercase tracking-[0.18em] text-emerald-200/70">
              Est. 2025
            </span>
          </div>
        </div>
        <div className="relative">
          <IconBell className="h-5 w-5 text-emerald-100/80" />
          <span className="absolute -right-1 -top-1 grid h-[15px] min-w-[15px] place-items-center rounded-full border border-[#042713] bg-red-500 px-1 text-[9px] font-bold text-white">
            3
          </span>
        </div>
      </div>

      <Rule />

      <div className="flex items-end justify-between">
        <div>
          <div className="text-[9px] uppercase tracking-[0.18em] text-emerald-200/65">
            Handicap
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold leading-none text-[#f5e6b0]">
              8.4
            </span>
            <span className="text-[10px] font-semibold text-emerald-400">
              −0.6 / 30d
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] uppercase tracking-[0.18em] text-emerald-200/65">
            Rounds
          </div>
          <div className="mt-1 text-2xl font-extrabold leading-none text-emerald-50">
            41
          </div>
        </div>
      </div>

      <Rule />

      <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-3">
        <div className="text-[9px] uppercase tracking-[0.18em] text-emerald-200/65">
          Last round
        </div>
        <div className="mt-1 text-xs font-semibold text-emerald-50">
          Wentworth (West) · Blue
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-2">
          <Stat label="Gross" value="82" />
          <Stat label="Net" value="74" />
          <Stat label="Diff" value="9.1" />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-[9px] uppercase tracking-[0.18em] text-emerald-200/65">
          Social highlights
        </div>
        <span className="text-[10px] font-semibold text-[#f5e6b0]">Open →</span>
      </div>

      <div className="space-y-1.5">
        {[
          { who: "TH", text: "Eagle on 12. Still talking about it." },
          { who: "RM", text: "Card in — 38 points off 14." },
        ].map((row) => (
          <div
            key={row.who}
            className="flex items-center gap-2.5 rounded-2xl border border-emerald-900/35 bg-emerald-950/10 px-2.5 py-2"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-emerald-900/45 bg-emerald-900/15 text-[10px] font-extrabold text-emerald-50/90">
              {row.who}
            </span>
            <span className="truncate text-[11px] text-emerald-100/70">
              {row.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- scoring -- */

const scoringRows = [
  { who: "JW", name: "J. Ware", strokes: 1, score: "4", pts: "3", under: true },
  { who: "TH", name: "T. Hale", strokes: 0, score: "5", pts: "1", under: false },
  { who: "RM", name: "R. Moss", strokes: 1, score: "5", pts: "2", under: false },
  { who: "DC", name: "D. Cole", strokes: 2, score: "6", pts: "2", under: false },
];

export function MockScoring() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-extrabold text-[#f5e6b0]">Hole 14</div>
          <div className="text-[10px] text-emerald-200/70">Par 4 · SI 3</div>
        </div>
        <span className="rounded-full border border-[#f5e6b0]/30 bg-[#f5e6b0]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#f5e6b0]">
          Stableford
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70">
        {scoringRows.map((r, i) => (
          <div
            key={r.who}
            className={`flex items-center gap-2 px-2.5 py-2.5 ${
              i < scoringRows.length - 1 ? "border-b border-emerald-900/60" : ""
            }`}
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-800 to-emerald-950 text-[9px] font-extrabold text-emerald-50">
              {r.who}
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-emerald-50">
              {r.name}
            </span>
            <span className="flex w-6 shrink-0 justify-center gap-0.5">
              {Array.from({ length: r.strokes }).map((_, d) => (
                <span
                  key={d}
                  className="inline-block h-1.5 w-1.5 rounded-full bg-[#f5e6b0]"
                />
              ))}
            </span>
            <span
              className={`grid h-5 min-w-[20px] shrink-0 place-items-center rounded-full text-[11px] font-extrabold ${
                r.under
                  ? "bg-[#f5e6b0] text-[#042713]"
                  : "text-emerald-50 ring-1 ring-emerald-800/60"
              }`}
            >
              {r.score}
            </span>
            <span className="w-5 shrink-0 text-right text-[11px] font-extrabold text-[#f5e6b0]">
              {r.pts}
            </span>
          </div>
        ))}
      </div>

      <div className="flex gap-[3px]">
        {Array.from({ length: 18 }).map((_, i) => {
          const hole = i + 1;
          const done = hole < 14;
          const active = hole === 14;
          return (
            <span
              key={hole}
              className={`grid h-4 flex-1 place-items-center rounded-[3px] text-[7px] font-bold ${
                active
                  ? "bg-[#f5e6b0] text-[#042713]"
                  : done
                    ? "bg-emerald-900/60 text-emerald-100/80"
                    : "bg-emerald-950/40 text-emerald-200/35"
              }`}
            >
              {hole}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- leaderboard -- */

const board = [
  { pos: "1", name: "T. Hale", thru: "F", pts: "39" },
  { pos: "2", name: "J. Ware", thru: "F", pts: "37" },
  { pos: "T3", name: "R. Moss", thru: "16", pts: "34" },
  { pos: "T3", name: "S. Iqbal", thru: "15", pts: "34" },
  { pos: "5", name: "D. Cole", thru: "16", pts: "31" },
];

export function MockLeaderboard() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-extrabold text-[#f5e6b0]">
            Spring Meeting
          </div>
          <div className="text-[10px] text-emerald-200/70">Round 2 of 3</div>
        </div>
        <span className="flex shrink-0 items-center gap-1 rounded-full border border-emerald-300/25 bg-emerald-400/15 px-2 py-0.5 text-[9px] font-extrabold tracking-wide text-emerald-100">
          <span className="ciaga-live-dot inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
          LIVE
        </span>
      </div>

      <div className="flex w-full items-center gap-1 rounded-full border border-emerald-900/60 bg-[#0b3b21]/50 p-1 shadow-inner shadow-black/20">
        {["Leaderboard", "Fixtures", "Standings"].map((t, i) => (
          <span
            key={t}
            className={`flex-1 whitespace-nowrap rounded-full px-2 py-1 text-center text-[9px] font-medium ${
              i === 0
                ? "bg-[#f5e6b0] text-[#042713] shadow-sm shadow-black/30"
                : "text-emerald-100/70"
            }`}
          >
            {t}
          </span>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70">
        {board.map((r, i) => (
          <div
            key={r.name}
            className={`flex items-center gap-2 px-2.5 py-2 ${
              i < board.length - 1 ? "border-b border-emerald-900/60" : ""
            }`}
          >
            <span
              className={`w-5 shrink-0 text-[10px] font-extrabold ${
                i === 0 ? "text-[#f5e6b0]" : "text-emerald-200/60"
              }`}
            >
              {r.pos}
            </span>
            <span
              className={`min-w-0 flex-1 truncate text-[11px] font-medium ${
                i === 0 ? "text-[#f5e6b0]" : "text-emerald-50"
              }`}
            >
              {r.name}
            </span>
            <span className="w-6 shrink-0 text-right text-[10px] text-emerald-200/60">
              {r.thru}
            </span>
            <span className="w-6 shrink-0 text-right text-[11px] font-extrabold text-emerald-50">
              {r.pts}
            </span>
          </div>
        ))}
      </div>

      {/* The app shows a currency figure in this snapshot. The marketing site
          deliberately shows a dash — the ledger framing lives in prose only. */}
      <div className="grid grid-cols-4 gap-1 rounded-2xl border border-emerald-900/60 bg-gradient-to-br from-[#0b3b21]/90 to-[#07301a]/90 px-2.5 py-2.5">
        {[
          ["Events", "6"],
          ["Rounds", "14"],
          ["Wins", "2"],
          ["Ledger", "—"],
        ].map(([label, value]) => (
          <div key={label} className="text-center">
            <div className="text-[8px] uppercase tracking-[0.12em] text-emerald-100/45">
              {label}
            </div>
            <div className="mt-0.5 text-xs font-extrabold text-emerald-50">
              {value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- fantasy -- */

const markets = [
  { name: "T. Hale", a: "5/2", b: "6/4", picked: false },
  { name: "J. Ware", a: "3/1", b: "2/1", picked: true },
  { name: "R. Moss", a: "9/2", b: "5/2", picked: false },
  { name: "S. Iqbal", a: "7/1", b: "4/1", picked: false },
];

export function MockFantasy() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-extrabold text-[#f5e6b0]">
            Spring Meeting
          </div>
          <div className="text-[10px] text-emerald-200/70">Markets</div>
        </div>
        <span className="rounded-full bg-[#f5e6b0]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#f5e6b0]">
          Virtual points
        </span>
      </div>

      <div className="flex items-center justify-between px-1">
        <span className="text-[9px] uppercase tracking-[0.14em] text-emerald-200/65">
          Player
        </span>
        <span className="flex gap-1.5">
          <span className="w-[52px] text-center text-[9px] uppercase tracking-[0.14em] text-emerald-200/65">
            Win
          </span>
          <span className="w-[52px] text-center text-[9px] uppercase tracking-[0.14em] text-emerald-200/65">
            Top 3
          </span>
        </span>
      </div>

      <div className="space-y-1.5">
        {markets.map((m) => (
          <div
            key={m.name}
            className="flex items-center gap-2 rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 px-2.5 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-emerald-50">
              {m.name}
            </span>
            <span className="w-[52px] shrink-0 rounded-lg border border-emerald-700/50 bg-emerald-950/40 px-2 py-1 text-center text-[11px] font-bold text-[#f5e6b0]">
              {m.a}
            </span>
            <span
              className={`w-[52px] shrink-0 rounded-lg border px-2 py-1 text-center text-[11px] font-bold ${
                m.picked
                  ? "border-[#f5e6b0] bg-[#f5e6b0] text-[#042713]"
                  : "border-emerald-700/50 bg-emerald-950/40 text-[#f5e6b0]"
              }`}
            >
              {m.b}
            </span>
          </div>
        ))}
      </div>

      <div className="-mx-3.5 -mb-6 mt-4 rounded-t-2xl border-t border-emerald-900/60 bg-[#071c10] p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[9px] uppercase tracking-[0.14em] text-emerald-200/65">
              3 legs
            </div>
            <div className="mt-0.5 text-[11px] font-extrabold text-emerald-50">
              250 pts → 2,140 pts
            </div>
          </div>
          <span className="rounded-full bg-[#f5e6b0] px-3 py-1.5 text-[10px] font-extrabold text-[#042713]">
            Place picks
          </span>
        </div>
      </div>
    </div>
  );
}
