"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { BackButton } from "@/components/ui/BackButton";
import { calcCourseHandicap } from "@/lib/rounds/setupHelpers";

/**
 * Course and playing handicap for any tee.
 *
 * The arithmetic is NOT reimplemented here — it calls calcCourseHandicap from
 * lib/rounds/setupHelpers, the same helper round setup uses, so this screen and
 * a real round can never disagree.
 */

const ALLOWANCES = [
  { pct: 100, label: "100%", hint: "Singles matchplay, most stroke play" },
  { pct: 95, label: "95%", hint: "Individual stroke play (field of 30+)" },
  { pct: 90, label: "90%", hint: "Fourball matchplay" },
  { pct: 85, label: "85%", hint: "Fourball stroke play" },
  { pct: 75, label: "75%", hint: "Foursomes and some team formats" },
  { pct: 50, label: "50%", hint: "Scramble and high-allowance team play" },
];

function parseNum(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
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
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--sec-muted)]">
        {label}
      </span>
      <input
        type="number"
        inputMode="decimal"
        step={step ?? "any"}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--ciaga-ground)_55%,transparent)] px-3 py-2.5 text-sm font-semibold text-[color:var(--sec-text)] outline-none placeholder:text-[color:var(--sec-muted)] focus:border-[color:color-mix(in_srgb,var(--sec-accent)_50%,transparent)]"
      />
    </label>
  );
}

export default function HandicapCalculatorClient() {
  const router = useRouter();

  const [hi, setHi] = useState("");
  const [slope, setSlope] = useState("");
  const [rating, setRating] = useState("");
  const [par, setPar] = useState("72");
  const [allowance, setAllowance] = useState(100);
  const [prefilled, setPrefilled] = useState(false);

  // Prefill the viewer's own index, so the common case is one tee away from an answer.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;
      if (!userId) return;

      const { data: profileRows } = await supabase
        .from("profiles")
        .select("id")
        .eq("owner_user_id", userId)
        .limit(1);

      const profileId = (profileRows as { id?: string }[] | null)?.[0]?.id;
      if (!profileId || cancelled) return;

      const { data, error } = await supabase.rpc("get_current_handicaps", {
        ids: [profileId],
      });
      if (cancelled || error) return;

      const index = (data as { handicap_index?: number | null }[] | null)?.[0]?.handicap_index;
      if (index === null || index === undefined) return;

      setHi(String(index));
      setPrefilled(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const result = useMemo(() => {
    const hiN = parseNum(hi);
    const slopeN = parseNum(slope);
    const ratingN = parseNum(rating);
    const parN = parseNum(par);

    if (hiN === null || slopeN === null || ratingN === null || parN === null) return null;
    if (slopeN <= 0) return null;

    const courseHandicap = calcCourseHandicap(hiN, slopeN, ratingN, parN);
    const playingHandicap = Math.round((courseHandicap * allowance) / 100);
    return { courseHandicap, playingHandicap };
  }, [hi, slope, rating, par, allowance]);

  const activeHint = ALLOWANCES.find((a) => a.pct === allowance)?.hint;

  return (
    <div className="min-h-screen bg-[color:var(--ciaga-ground)] px-4 pt-8 text-slate-100">
      <div className="mx-auto w-full max-w-sm space-y-6">
        <header className="relative flex items-center justify-center">
          <BackButton className="absolute left-0 font-semibold" onClick={() => router.back()} />
          <div className="text-center">
            <div className="text-lg font-extrabold tracking-wide text-[color:var(--sec-accent)]">Handicap</div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--sec-muted)]">
              Calculator
            </div>
          </div>
        </header>

        {/* Result first — it is the reason you opened this screen. */}
        <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] p-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--sec-muted)]">
                Course HCP
              </div>
              <div className="mt-1 text-3xl font-extrabold tabular-nums text-[color:var(--sec-accent)]">
                {result ? result.courseHandicap : "—"}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--sec-muted)]">
                Playing HCP
              </div>
              <div className="mt-1 text-3xl font-extrabold tabular-nums text-[color:var(--sec-accent)]">
                {result ? result.playingHandicap : "—"}
              </div>
            </div>
          </div>
          <div className="mt-3 border-t border-[color:var(--sec-hair)] pt-3 text-[11px] font-semibold text-[color:var(--sec-muted)]">
            {result
              ? `${allowance}% of course handicap`
              : "Enter your index and the tee's slope, rating and par"}
          </div>
        </div>

        <div className="space-y-3">
          <Field
            label={prefilled ? "Handicap index (yours)" : "Handicap index"}
            value={hi}
            onChange={setHi}
            placeholder="12.4"
            step="0.1"
          />
          <div className="grid grid-cols-3 gap-2">
            <Field label="Slope" value={slope} onChange={setSlope} placeholder="113" />
            <Field
              label="Rating"
              value={rating}
              onChange={setRating}
              placeholder="71.2"
              step="0.1"
            />
            <Field label="Par" value={par} onChange={setPar} placeholder="72" />
          </div>
        </div>

        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--sec-muted)]">
            Allowance
          </div>
          <div className="flex flex-wrap gap-2">
            {ALLOWANCES.map((a) => (
              <button
                key={a.pct}
                type="button"
                onClick={() => setAllowance(a.pct)}
                aria-pressed={allowance === a.pct}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  allowance === a.pct
                    ? "border-[color:color-mix(in_srgb,var(--sec-accent)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--sec-accent)_10%,transparent)] text-[color:var(--sec-accent)]"
                    : "border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_50%,transparent)] text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text)]"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="mt-2 text-[11px] font-semibold text-[color:var(--sec-muted)]">{activeHint}</div>
        </div>

        <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] px-4 py-3 text-[11px] font-semibold leading-relaxed text-[color:var(--sec-muted)]">
          Course Handicap = Index × (Slope ÷ 113) + (Rating − Par), rounded to the nearest
          whole stroke. Playing Handicap applies the competition allowance.
        </div>

        <div className="pt-1 text-center text-[10px] font-semibold text-[color:var(--sec-muted)]">
          CIAGA · Handicap Calculator
        </div>
      </div>
    </div>
  );
}
