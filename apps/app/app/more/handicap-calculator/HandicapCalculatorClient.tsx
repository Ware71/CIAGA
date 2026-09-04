"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { CourseBrowser } from "@/components/courses/CourseBrowser";
import { PeoplePicker, type Person } from "@/components/people/PeoplePicker";
import { Figures, Group, Hero, PageHeader, Row } from "@/components/ui/chrome";
import { calcCourseHandicap } from "@/lib/rounds/setupHelpers";
import { getWhsDefaultPolicy } from "@/lib/rounds/whsDefaults";
import { resolvePlayingHandicapPreview } from "@/lib/rounds/playingHandicapPreview";
import { scoreDifferential } from "@/lib/whs/scoreDifferential";
import type { RoundFormatType } from "@/components/rounds/FormatSelector";
import { X } from "lucide-react";

/**
 * Course and playing handicap for any tee, for you and whoever you're playing.
 *
 * None of the arithmetic lives here. Course handicap comes from
 * calcCourseHandicap, the playing handicap from resolvePlayingHandicapPreview
 * (which mirrors the SQL resolver), the allowance from getWhsDefaultPolicy, and
 * the differential from scoreDifferential. This screen used to carry its own
 * allowance table — a fourth copy, disagreeing with the three real ones — and a
 * hand-typed slope and rating. Both are gone: you pick a format and a tee.
 *
 * Picking a format rather than a bare percentage is what lets matchplay work at
 * all. Its WHS answer is "off the lowest", which no flat percentage can express.
 */

/** Formats worth offering here — the ones a player computes a handicap for. */
const FORMATS: { key: RoundFormatType; label: string }[] = [
  { key: "strokeplay", label: "Strokeplay" },
  { key: "stableford", label: "Stableford" },
  { key: "matchplay", label: "Matchplay" },
  { key: "pairs_stableford", label: "Pairs" },
  { key: "team_bestball", label: "Fourball" },
  { key: "foursomes", label: "Foursomes" },
];

type TeeBox = {
  id: string;
  name: string | null;
  gender: string | null;
  rating: number | null;
  slope: number | null;
  par: number | null;
  yards: number | null;
  holes_count: number | null;
  sort_order: number | null;
};

type PlayerRow = {
  id: string;
  name: string;
  handicapIndex: number | null;
  courseHandicap: number | null;
  playingHandicap: number | null;
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
  const [teeBoxes, setTeeBoxes] = useState<TeeBox[]>([]);
  const [teeId, setTeeId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [teeLoading, setTeeLoading] = useState(false);

  const [format, setFormat] = useState<RoundFormatType>("strokeplay");

  const [myIndex, setMyIndex] = useState<number | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [myName, setMyName] = useState("You");
  const [manualHi, setManualHi] = useState("");

  const [friends, setFriends] = useState<Person[]>([]);
  const [friendIndexes, setFriendIndexes] = useState<Record<string, number | null>>({});

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

  /** Tees for a chosen course, sorted and filtered the way round setup does. */
  const loadTees = useCallback(async (courseId: string) => {
    setTeeLoading(true);
    try {
      const res = await fetch(`/api/courses/detail?course_id=${courseId}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      // Already sorted hardest-first (rating, slope, yards, name) by the route,
      // so no re-sort here — and a client-side one would compare `numeric`
      // columns that can arrive as strings.
      const boxes: TeeBox[] = Array.isArray(json?.tee_boxes) ? json.tee_boxes : [];
      setTeeBoxes(boxes);
      const first = boxes[0];
      if (first) applyTee(first);
    } catch {
      setTeeBoxes([]);
    } finally {
      setTeeLoading(false);
    }
  }, []);

  function applyTee(tee: TeeBox) {
    setTeeId(tee.id);
    const s = num(tee.slope);
    const r = num(tee.rating);
    const p = num(tee.par);
    if (s !== null) setSlope(String(s));
    if (r !== null) setRating(String(r));
    if (p !== null) setPar(String(p));
    // A tee named "(Front 9)" / "(Back 9)" carries 9-hole figures.
    const nine = tee.holes_count === 9 || /\((front|back) 9\)/i.test(tee.name ?? "");
    setHoles(nine ? 9 : 18);
  }

  const policy = useMemo(() => getWhsDefaultPolicy(format), [format]);

  const teeReady = useMemo(() => {
    const s = parseNum(slope);
    const r = parseNum(rating);
    const p = parseNum(par);
    return s !== null && s > 0 && r !== null && p !== null ? { s, r, p } : null;
  }, [slope, rating, par]);

  /** Everyone in the party, with their handicaps at this tee. */
  const rows = useMemo<PlayerRow[]>(() => {
    const manual = parseNum(manualHi);
    const mine = manual ?? myIndex;

    const people: { id: string; name: string; hi: number | null }[] = [
      { id: myId ?? "me", name: myName, hi: mine },
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
        value: policy.allowance_pct,
        lowestCourseHandicap: lowest,
      }),
    }));
  }, [myId, myName, myIndex, manualHi, friends, friendIndexes, teeReady, holes, policy]);

  const me = rows[0];

  const differential = useMemo(() => {
    const a = parseNum(ags);
    if (a === null || !teeReady) return null;
    return scoreDifferential({ ags: a, courseRating: teeReady.r, slope: teeReady.s });
  }, [ags, teeReady]);

  const allowanceLabel =
    policy.mode === "compare_against_lowest"
      ? "Off the lowest handicap"
      : `${policy.allowance_pct}% of course handicap`;

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
        <Group label="You" className="mb-2">
          <Hero
            figure={me?.playingHandicap ?? "—"}
            caption={`Playing handicap · ${allowanceLabel}`}
            sideLabel="Course"
            sideValue={me?.courseHandicap ?? "—"}
          />
        </Group>

        <Group label="Course & tee">
          <Row
            onClick={() => setPickerOpen(true)}
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

          {teeLoading ? (
            <p className="py-2 text-[length:var(--t-sec)] text-[color:var(--sec-muted)]">
              Loading tees…
            </p>
          ) : teeBoxes.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 py-2.5">
              {teeBoxes.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTee(t)}
                  aria-pressed={teeId === t.id}
                  className={
                    teeId === t.id
                      ? "rounded-full bg-[color:var(--sec-accent)] px-3 py-1.5 text-[length:var(--t-sec)] font-medium text-[color:var(--ciaga-ground)]"
                      : "rounded-full border border-[color:var(--sec-hair)] px-3 py-1.5 text-[length:var(--t-sec)] text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text)]"
                  }
                >
                  {t.name ?? "Tee"}
                </button>
              ))}
            </div>
          ) : null}

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
                  <button
                    key={h}
                    type="button"
                    onClick={() => setHoles(h)}
                    aria-pressed={holes === h}
                    className={
                      holes === h
                        ? "rounded-full bg-[color:var(--sec-accent)] px-3 py-1 text-[length:var(--t-sec)] font-medium text-[color:var(--ciaga-ground)]"
                        : "rounded-full border border-[color:var(--sec-hair)] px-3 py-1 text-[length:var(--t-sec)] text-[color:var(--sec-muted)]"
                    }
                  >
                    {h}
                  </button>
                ))}
              </span>
            }
          />
        </Group>

        <Group label="Format">
          <div className="flex flex-wrap gap-1.5 py-2.5">
            {FORMATS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFormat(f.key)}
                aria-pressed={format === f.key}
                className={
                  format === f.key
                    ? "rounded-full bg-[color:var(--sec-accent)] px-3 py-1.5 text-[length:var(--t-sec)] font-medium text-[color:var(--ciaga-ground)]"
                    : "rounded-full border border-[color:var(--sec-hair)] px-3 py-1.5 text-[length:var(--t-sec)] text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text)]"
                }
              >
                {f.label}
              </button>
            ))}
          </div>
          <p className="pb-2.5 text-[length:var(--t-sec)] text-[color:var(--sec-muted)]">
            {allowanceLabel}. WHS default for this format — the same seed a real round uses.
          </p>
        </Group>

        <Group label="Playing with">
          {rows.map((r, i) => (
            <Row
              key={r.id}
              title={r.name}
              subtitle={
                r.handicapIndex !== null
                  ? `Index ${r.handicapIndex.toFixed(1)}`
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
              max={5}
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
              teeReady
                ? "(AGS − rating) × 113 ÷ slope"
                : "Set a tee's rating and slope first"
            }
            trailing={
              <span className="text-[length:var(--t-fig)] font-medium tabular-nums text-[color:var(--sec-accent)]">
                {differential !== null ? differential.toFixed(1) : "—"}
              </span>
            }
          />
          <div className="py-2.5">
            <Field
              label="Adjusted gross score"
              value={ags}
              onChange={setAgs}
              placeholder="85"
            />
          </div>
        </Group>
      </div>

      {pickerOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-[color:var(--ciaga-ground)]">
          <div className="mx-auto flex min-h-0 w-full max-w-sm flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6">
            <header className="flex shrink-0 items-center justify-between pb-3">
              <h2 className="text-[length:var(--t-fig)] font-semibold text-[color:var(--sec-text)]">
                Choose a course
              </h2>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
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
                setPickerOpen(false);
                void loadTees(courseId);
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
