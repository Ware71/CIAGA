"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { CourseBrowser } from "@/components/courses/CourseBrowser";
import {
  TeePickerSheet,
  teeHolesCount,
  type TeeOption,
} from "@/components/courses/TeePickerSheet";
import { PeoplePicker, type Person } from "@/components/people/PeoplePicker";
import { Figures, Group, Hero, PageHeader, Row } from "@/components/ui/chrome";
import { calcCourseHandicap } from "@/lib/rounds/setupHelpers";
import { getWhsDefaultPolicy } from "@/lib/rounds/whsDefaults";
import { resolvePlayingHandicapPreview } from "@/lib/rounds/playingHandicapPreview";
import {
  calcTeamHandicap,
  isSingleBallFormat,
  teamHandicapDescription,
} from "@/lib/rounds/teamHandicap";
import { isTeamFormat } from "@/lib/rounds/formatScoring";
import { scoreDifferential } from "@/lib/whs/scoreDifferential";
import { FORMAT_LABELS, type RoundFormatType } from "@/components/rounds/FormatSelector";
import { cn } from "@/lib/utils";

/**
 * Course and playing handicap for any tee, for you and whoever you're playing.
 *
 * None of the arithmetic lives here. Course handicap comes from
 * calcCourseHandicap, the playing handicap from resolvePlayingHandicapPreview
 * (which mirrors the SQL resolver), the team handicap from calcTeamHandicap
 * (shared with the round-start route), the allowance seed from
 * getWhsDefaultPolicy, and the differential from scoreDifferential. This screen
 * used to carry its own allowance table — a fourth copy, disagreeing with the
 * three real ones — and a hand-typed slope and rating.
 *
 * Format drives the allowance rather than the other way round, which is what
 * lets matchplay work at all: its WHS answer is "off the lowest", and no flat
 * percentage can express that. The percentage is still editable, because the
 * WHS figures are recommendations and societies vary them.
 */

const SINGLES: RoundFormatType[] = ["strokeplay", "stableford", "matchplay"];
const TEAMS: RoundFormatType[] = [
  "pairs_stableford",
  "team_strokeplay",
  "team_stableford",
  "team_bestball",
  "scramble",
  "greensomes",
  "foursomes",
];

type PlayerRow = {
  id: string;
  name: string;
  handicapIndex: number | null;
  courseHandicap: number | null;
  playingHandicap: number | null;
  teamIndex: number;
};

function parseNum(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Postgres `numeric` — course rating, handicap index — reaches the client as a
 * number or a string depending on the driver and the column. Coerce once here
 * rather than discovering it via `.toFixed is not a function` at render.
 */
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

function Field({
  label,
  value,
  onChange,
  placeholder,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  step?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[length:var(--t-label)] font-medium uppercase tracking-[0.1em] text-[color:var(--sec-muted)]">
        {label}
      </span>
      <input
        type="number"
        inputMode="decimal"
        step={step ?? "any"}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-[var(--r-ui)] border border-[color:var(--sec-hair)] bg-[color:var(--sec-surface)] px-3 py-2 text-[length:var(--t-body)] tabular-nums text-[color:var(--sec-text)] outline-none placeholder:text-[color:var(--sec-muted)] focus:border-[color:var(--sec-accent)]"
      />
    </label>
  );
}

export default function HandicapCalculatorClient() {
  // Tee inputs — filled by picking a course, still editable for a course we
  // don't hold, which is the case for most of the world.
  const [slope, setSlope] = useState("");
  const [rating, setRating] = useState("");
  const [par, setPar] = useState("72");
  const [holes, setHoles] = useState<9 | 18>(18);

  const [courseName, setCourseName] = useState<string | null>(null);
  const [teeBoxes, setTeeBoxes] = useState<TeeOption[]>([]);
  const [teeId, setTeeId] = useState<string | null>(null);
  const [teeName, setTeeName] = useState<string | null>(null);
  const [coursePickerOpen, setCoursePickerOpen] = useState(false);
  const [teePickerOpen, setTeePickerOpen] = useState(false);
  const [teeLoading, setTeeLoading] = useState(false);

  const [tab, setTab] = useState<"singles" | "teams">("singles");
  const [format, setFormat] = useState<RoundFormatType>("strokeplay");
  /** null = follow the format's WHS default; a number = the user overrode it. */
  const [allowanceOverride, setAllowanceOverride] = useState<number | null>(null);

  const [myIndex, setMyIndex] = useState<number | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [myName, setMyName] = useState("You");
  const [manualHi, setManualHi] = useState("");

  const [friends, setFriends] = useState<Person[]>([]);
  const [friendIndexes, setFriendIndexes] = useState<Record<string, number | null>>({});
  /** playerId → team index. Everyone starts on team 1. */
  const [teamOf, setTeamOf] = useState<Record<string, number>>({});
  const [teamCount, setTeamCount] = useState(2);

  const [ags, setAgs] = useState("");

  // Your own index, so the common case is one tee away from an answer.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data: rows } = await supabase
        .from("profiles")
        .select("id, name")
        .eq("owner_user_id", auth.user.id)
        .limit(1);
      const me = (rows as { id?: string; name?: string }[] | null)?.[0];
      if (!me?.id || cancelled) return;
      setMyId(me.id);
      if (me.name) setMyName(me.name);

      const { data } = await supabase.rpc("get_current_handicaps", { ids: [me.id] });
      const idx = num((data as { handicap_index?: unknown }[] | null)?.[0]?.handicap_index);
      if (!cancelled && idx !== null) setMyIndex(idx);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Everyone's index in one call, refreshed as the party changes.
  useEffect(() => {
    if (friends.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("get_current_handicaps", {
        ids: friends.map((f) => f.id),
      });
      if (cancelled) return;
      // get_current_handicaps returns (profile_id, handicap_index, as_of_date).
      const next: Record<string, number | null> = {};
      for (const row of (data ?? []) as any[]) {
        next[row.profile_id] = num(row.handicap_index);
      }
      setFriendIndexes((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      cancelled = true;
    };
  }, [friends]);

  /**
   * Keep team assignments sane as the party and the team count change.
   *
   * New players are dealt to the smallest team rather than all piling onto team
   * one, so a fourball splits 2–2 without anyone dragging chips around. And
   * dropping the team count would otherwise strand players on an index that no
   * longer renders — they'd vanish from the builder while still counting.
   */
  useEffect(() => {
    const ids = [myId ?? "me", ...friends.map((f) => f.id)];
    setTeamOf((prev) => {
      const next: Record<string, number> = {};
      const sizes = new Array(teamCount).fill(0);

      for (const id of ids) {
        const existing = prev[id];
        if (typeof existing === "number" && existing < teamCount) {
          next[id] = existing;
          sizes[existing] += 1;
        }
      }
      for (const id of ids) {
        if (id in next) continue;
        let smallest = 0;
        for (let i = 1; i < teamCount; i++) if (sizes[i] < sizes[smallest]) smallest = i;
        next[id] = smallest;
        sizes[smallest] += 1;
      }

      const unchanged =
        Object.keys(next).length === Object.keys(prev).length &&
        ids.every((id) => prev[id] === next[id]);
      return unchanged ? prev : next;
    });
  }, [myId, friends, teamCount]);

  /** Tees for a chosen course. */
  const loadTees = useCallback(async (courseId: string) => {
    setTeeLoading(true);
    try {
      const res = await fetch(`/api/courses/detail?course_id=${courseId}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      // Already sorted hardest-first (rating, slope, yards, name) by the route,
      // so no re-sort here — and a client-side one would compare `numeric`
      // columns that can arrive as strings.
      const boxes: TeeOption[] = Array.isArray(json?.tee_boxes) ? json.tee_boxes : [];
      setTeeBoxes(boxes);
      // Default to the first full-18 tee rather than whatever sorts first, which
      // is often a synthetic front-nine row.
      const first = boxes.find((t) => teeHolesCount(t) === 18) ?? boxes[0];
      if (first) applyTee(first);
    } catch {
      setTeeBoxes([]);
    } finally {
      setTeeLoading(false);
    }
  }, []);

  function applyTee(tee: TeeOption) {
    setTeeId(tee.id);
    setTeeName(tee.name ?? "Tee");
    const s = num(tee.slope);
    const r = num(tee.rating);
    const p = num(tee.par);
    if (s !== null) setSlope(String(s));
    if (r !== null) setRating(String(r));
    if (p !== null) setPar(String(p));
    setHoles(teeHolesCount(tee) === 9 ? 9 : 18);
  }

  const policy = useMemo(() => getWhsDefaultPolicy(format), [format]);
  /** The percentage actually applied — the override if set, else the WHS seed. */
  const allowance = allowanceOverride ?? policy.allowance_pct;
  const overridden = allowanceOverride !== null && allowanceOverride !== policy.allowance_pct;

  function chooseFormat(next: RoundFormatType) {
    setFormat(next);
    // Auto-update: a new format brings its own WHS allowance, so a percentage
    // typed for the previous one would silently carry over and be wrong.
    setAllowanceOverride(null);
  }

  const teeReady = useMemo(() => {
    const s = parseNum(slope);
    const r = parseNum(rating);
    const p = parseNum(par);
    return s !== null && s > 0 && r !== null && p !== null ? { s, r, p } : null;
  }, [slope, rating, par]);

  const isTeams = isTeamFormat(format);
  const singleBall = isSingleBallFormat(format);

  /** Everyone in the party, with their handicaps at this tee. */
  const rows = useMemo<PlayerRow[]>(() => {
    const manual = parseNum(manualHi);
    const mine = manual ?? myIndex;
    const meKey = myId ?? "me";

    const people: { id: string; name: string; hi: number | null }[] = [
      { id: meKey, name: myName, hi: mine },
      ...friends.map((f) => ({
        id: f.id,
        name: f.name ?? "Player",
        hi: friendIndexes[f.id] ?? null,
      })),
    ];

    const withCourse = people.map((p) => ({
      ...p,
      ch:
        teeReady && p.hi !== null
          ? calcCourseHandicap(p.hi, teeReady.s, teeReady.r, teeReady.p, holes)
          : null,
    }));

    // Matchplay needs the field's lowest course handicap before anyone's
    // playing handicap can be resolved — that is the whole "off the lowest" idea.
    const known = withCourse.map((p) => p.ch).filter((n): n is number => n !== null);
    const lowest = known.length ? Math.min(...known) : null;

    return withCourse.map((p) => ({
      id: p.id,
      name: p.name,
      handicapIndex: p.hi,
      courseHandicap: p.ch,
      playingHandicap: resolvePlayingHandicapPreview({
        courseHandicap: p.ch,
        mode: policy.mode,
        value: allowance,
        lowestCourseHandicap: lowest,
      }),
      teamIndex: teamOf[p.id] ?? 0,
    }));
  }, [myId, myName, myIndex, manualHi, friends, friendIndexes, teeReady, holes, policy, allowance, teamOf]);

  const me = rows[0];

  /** Per-team handicaps, for the three single-ball formats only. */
  const teams = useMemo(() => {
    if (!isTeams) return [];
    return Array.from({ length: teamCount }, (_, i) => {
      const members = rows.filter((r) => r.teamIndex === i);
      return {
        index: i,
        members,
        handicap: singleBall
          ? calcTeamHandicap(format, members.map((m) => m.courseHandicap))
          : null,
      };
    });
  }, [isTeams, teamCount, rows, singleBall, format]);

  const differential = useMemo(() => {
    const a = parseNum(ags);
    if (a === null || !teeReady) return null;
    return scoreDifferential({ ags: a, courseRating: teeReady.r, slope: teeReady.s });
  }, [ags, teeReady]);

  const allowanceLabel =
    policy.mode === "compare_against_lowest"
      ? `Off the lowest handicap, at ${allowance}%`
      : `${allowance}% of course handicap`;

  const heroFigure = singleBall
    ? teams[0]?.handicap ?? "—"
    : me?.playingHandicap ?? "—";
  const heroCaption = singleBall
    ? `Team handicap · ${teamHandicapDescription(format, teams[0]?.members.length ?? 2)}`
    : `Playing handicap · ${allowanceLabel}`;

  return (
    <div className="min-h-screen px-4 pb-8">
      <div className="mx-auto w-full max-w-sm">
        <PageHeader
          title="Handicap calculator"
          parent="More"
          parentHref="/more"
          subtitle={courseName ?? "Pick a course, or type a tee in by hand"}
        />

        {/* The answer, first — it's why you opened this. */}
        <Group label={singleBall ? "Your team" : "You"} className="mb-2">
          <Hero
            figure={heroFigure}
            caption={heroCaption}
            sideLabel={singleBall ? "Players" : "Course"}
            sideValue={singleBall ? teams[0]?.members.length ?? 0 : me?.courseHandicap ?? "—"}
          />
        </Group>

        <Group label="Course & tee">
          <Row
            onClick={() => setCoursePickerOpen(true)}
            title={courseName ?? "Choose a course"}
            subtitle={
              teeBoxes.length
                ? `${teeBoxes.length} tee${teeBoxes.length === 1 ? "" : "s"}`
                : "Search nearby or worldwide"
            }
            trailing={
              <span className="text-[length:var(--t-fig)] leading-none text-[color:var(--sec-muted)]">
                ›
              </span>
            }
          />

          {/* The tee opens a sheet like the course does. A course routinely has
              a dozen tees once men's, women's and the synthetic nines are
              counted, which is too many for a row of chips. */}
          <Row
            onClick={teeBoxes.length ? () => setTeePickerOpen(true) : undefined}
            title={teeName ?? (teeLoading ? "Loading tees…" : "Choose a tee")}
            subtitle={
              teeReady
                ? `CR ${teeReady.r} · SL ${teeReady.s} · Par ${teeReady.p} · ${holes} holes`
                : teeBoxes.length
                  ? "Men's and women's, 18 and 9"
                  : "Pick a course first, or type the numbers below"
            }
            trailing={
              teeBoxes.length ? (
                <span className="text-[length:var(--t-fig)] leading-none text-[color:var(--sec-muted)]">
                  ›
                </span>
              ) : undefined
            }
          />

          <div className="grid grid-cols-3 gap-2 py-2.5">
            <Field label="Slope" value={slope} onChange={setSlope} placeholder="113" />
            <Field label="Rating" value={rating} onChange={setRating} placeholder="71.2" step="0.1" />
            <Field label="Par" value={par} onChange={setPar} placeholder="72" />
          </div>

          <Row
            title="Holes"
            subtitle={holes === 9 ? "Index is halved over 9" : "Full 18-hole index"}
            trailing={
              <span className="flex gap-1.5">
                {([18, 9] as const).map((h) => (
                  <Chip key={h} on={holes === h} onClick={() => setHoles(h)}>
                    {h}
                  </Chip>
                ))}
              </span>
            }
          />
        </Group>

        <Group label="Format">
          {/* Singles and teams are different questions — a team format brings a
              team builder and, for the single-ball three, a team handicap. */}
          <div className="flex gap-1.5 pt-2.5" role="tablist">
            {(["singles", "teams"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => {
                  setTab(t);
                  chooseFormat(t === "singles" ? "strokeplay" : "pairs_stableford");
                }}
                className={cn(
                  "flex-1 rounded-[var(--r-ui)] px-3 py-2 text-[length:var(--t-sec)] font-medium transition-colors",
                  tab === t
                    ? "bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)]"
                    : "border border-[color:var(--sec-hair)] text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text)]"
                )}
              >
                {t === "singles" ? "Singles" : "Teams"}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5 py-2.5">
            {(tab === "singles" ? SINGLES : TEAMS).map((f) => (
              <Chip key={f} on={format === f} onClick={() => chooseFormat(f)}>
                {FORMAT_LABELS[f]}
              </Chip>
            ))}
          </div>

          {/* Editable, but seeded from the format. WHS allowances are
              recommendations and societies vary them, so the number is a
              starting point rather than a lock. */}
          <Row
            title="Allowance"
            subtitle={
              overridden
                ? `Edited — WHS default for ${FORMAT_LABELS[format]} is ${policy.allowance_pct}%`
                : allowanceLabel
            }
            trailing={
              <span className="flex items-center gap-2">
                {overridden ? (
                  <button
                    type="button"
                    onClick={() => setAllowanceOverride(null)}
                    className="text-[length:var(--t-sec)] text-[color:var(--sec-muted)] underline underline-offset-2 hover:text-[color:var(--sec-text)]"
                  >
                    Reset
                  </button>
                ) : null}
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={200}
                    aria-label="Handicap allowance percentage"
                    value={String(allowance)}
                    onChange={(e) => {
                      const n = parseNum(e.target.value);
                      setAllowanceOverride(n === null ? null : Math.max(0, Math.min(200, n)));
                    }}
                    className="w-[68px] rounded-[var(--r-ui)] border border-[color:var(--sec-hair)] bg-[color:var(--sec-surface)] px-2 py-1.5 text-right text-[length:var(--t-body)] tabular-nums text-[color:var(--sec-text)] outline-none focus:border-[color:var(--sec-accent)]"
                  />
                  <span className="text-[length:var(--t-body)] text-[color:var(--sec-muted)]">%</span>
                </span>
              </span>
            }
          />
        </Group>

        {isTeams ? (
          <Group
            label="Teams"
            action={
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setTeamCount((c) => Math.max(2, c - 1))}
                  aria-label="Fewer teams"
                  className="px-1.5 hover:text-[color:var(--sec-text)]"
                >
                  −
                </button>
                <span className="tabular-nums">{teamCount}</span>
                <button
                  type="button"
                  onClick={() => setTeamCount((c) => Math.min(4, c + 1))}
                  aria-label="More teams"
                  className="px-1.5 hover:text-[color:var(--sec-text)]"
                >
                  +
                </button>
              </span>
            }
          >
            {teams.map((t) => (
              <div key={t.index} className="border-b border-[color:var(--hair)] py-2.5 last:border-b-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[length:var(--t-body)] font-medium text-[color:var(--sec-text)]">
                    Team {t.index + 1}
                  </span>
                  {singleBall ? (
                    <span className="text-[length:var(--t-fig)] font-medium tabular-nums text-[color:var(--sec-accent)]">
                      {t.handicap ?? "—"}
                    </span>
                  ) : null}
                </div>
                {singleBall && t.members.length > 0 ? (
                  <p className="mt-[2px] text-[length:var(--t-label)] text-[color:var(--sec-muted)]">
                    {teamHandicapDescription(format, t.members.length)}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {t.members.length === 0 ? (
                    <span className="text-[length:var(--t-sec)] text-[color:var(--sec-muted)]">
                      Nobody yet
                    </span>
                  ) : (
                    t.members.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() =>
                          setTeamOf((prev) => ({
                            ...prev,
                            [m.id]: ((prev[m.id] ?? 0) + 1) % teamCount,
                          }))
                        }
                        title="Move to the next team"
                        className="rounded-full border border-[color:var(--sec-hair)] bg-[color:var(--sec-surface)] px-2.5 py-1 text-[length:var(--t-sec)] text-[color:var(--sec-text)]"
                      >
                        {m.name}
                        {m.courseHandicap !== null ? (
                          <span className="ml-1.5 tabular-nums text-[color:var(--sec-muted)]">
                            {m.courseHandicap}
                          </span>
                        ) : null}
                      </button>
                    ))
                  )}
                </div>
              </div>
            ))}
            <p className="py-2 text-[length:var(--t-label)] text-[color:var(--sec-muted)]">
              {singleBall
                ? "Tap a player to move them. One ball per team, so the team plays off a weighted handicap."
                : "Tap a player to move them. Everyone plays their own ball off their own allowance."}
            </p>
          </Group>
        ) : null}

        <Group label="Playing with">
          {rows.map((r, i) => (
            <Row
              key={r.id}
              title={r.name}
              subtitle={
                r.handicapIndex !== null
                  ? `Index ${r.handicapIndex.toFixed(1)}${isTeams ? ` · Team ${r.teamIndex + 1}` : ""}`
                  : i === 0
                    ? "No index yet — type one below"
                    : "No index on record"
              }
              trailing={
                <Figures
                  items={[
                    { label: "Course", value: r.courseHandicap ?? "—" },
                    { label: "Playing", value: r.playingHandicap ?? "—", tone: "accent" },
                  ]}
                />
              }
            />
          ))}

          <div className="py-2.5">
            <PeoplePicker
              selected={friends}
              onChange={setFriends}
              excludeIds={myId ? [myId] : []}
              max={7}
              label="Add a playing partner"
            />
          </div>

          {myIndex === null ? (
            <div className="pb-2.5">
              <Field
                label="Your handicap index"
                value={manualHi}
                onChange={setManualHi}
                placeholder="12.4"
                step="0.1"
              />
            </div>
          ) : null}
        </Group>

        <Group label="Score differential">
          <Row
            title="From a gross score"
            subtitle={
              teeReady ? "(AGS − rating) × 113 ÷ slope" : "Set a tee's rating and slope first"
            }
            trailing={
              <span className="text-[length:var(--t-fig)] font-medium tabular-nums text-[color:var(--sec-accent)]">
                {differential !== null ? differential.toFixed(1) : "—"}
              </span>
            }
          />
          <div className="py-2.5">
            <Field label="Adjusted gross score" value={ags} onChange={setAgs} placeholder="85" />
          </div>
        </Group>
      </div>

      {coursePickerOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-[color:var(--ciaga-ground)]">
          <div className="mx-auto flex min-h-0 w-full max-w-sm flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6">
            <header className="flex shrink-0 items-center justify-between pb-3">
              <h2 className="text-[length:var(--t-fig)] font-semibold text-[color:var(--sec-text)]">
                Choose a course
              </h2>
              <button
                type="button"
                onClick={() => setCoursePickerOpen(false)}
                aria-label="Close"
                className="grid h-9 w-9 place-items-center rounded-full text-[color:var(--sec-muted)] hover:bg-[color:var(--sec-surface)] hover:text-[color:var(--sec-text)]"
              >
                <X size={20} />
              </button>
            </header>
            <CourseBrowser
              mode="select"
              onSelect={(courseId, name) => {
                setCourseName(name);
                setTeeName(null);
                setTeeId(null);
                setCoursePickerOpen(false);
                void loadTees(courseId);
              }}
            />
          </div>
        </div>
      ) : null}

      {teePickerOpen ? (
        <TeePickerSheet
          tees={teeBoxes}
          selectedId={teeId}
          courseName={courseName}
          onClose={() => setTeePickerOpen(false)}
          onSelect={(t) => {
            applyTee(t);
            setTeePickerOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
