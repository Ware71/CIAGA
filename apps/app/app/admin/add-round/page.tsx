"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { BackButton } from "@/components/ui/BackButton";

// ─── Types ───────────────────────────────────────────────────────────────────

type Course = { id: string; name: string; city: string | null; country: string | null };
type TeeBox = { id: string; name: string; rating: number | null; slope: number | null; holes_count: number | null };
type TeeHole = { hole_number: number; par: number | null };
type Player = { profile_id: string; display_name: string; handicap_index: string };
type ProfileResult = { id: string; name: string | null; email: string | null };

const STEPS = ["Round Details", "Players", "Scores", "Review"];

// ─── Component ───────────────────────────────────────────────────────────────

export default function AddHistoricalRoundPage() {
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [adminOk, setAdminOk] = useState(false);
  const [step, setStep] = useState(0);

  // Step 1
  const [playedAt, setPlayedAt] = useState("");
  const [roundName, setRoundName] = useState("");
  const [courseQuery, setCourseQuery] = useState("");
  const [courseResults, setCourseResults] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [teeBoxes, setTeeBoxes] = useState<TeeBox[]>([]);
  const [selectedTeeBoxId, setSelectedTeeBoxId] = useState("");
  const [teeHoles, setTeeHoles] = useState<TeeHole[]>([]);

  // Step 2
  const [playerQuery, setPlayerQuery] = useState("");
  const [playerResults, setPlayerResults] = useState<ProfileResult[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);

  // Step 3 — scores[profile_id][hole_number] = strokes string
  const [scores, setScores] = useState<Record<string, Record<number, string>>>({});

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok?: boolean; round_id?: string; error?: string } | null>(null);

  const courseSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Admin guard ────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    async function guard() {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) { router.replace("/auth"); return; }
      const { data } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("owner_user_id", auth.user.id)
        .limit(1);
      if (cancelled) return;
      if (!data?.[0]?.is_admin) { router.replace("/"); return; }
      setAdminOk(true);
      setChecking(false);
    }
    guard();
    return () => { cancelled = true; };
  }, [router]);

  // ── Course search ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (courseSearchTimeout.current) clearTimeout(courseSearchTimeout.current);
    if (!courseQuery.trim() || selectedCourse) { setCourseResults([]); return; }
    courseSearchTimeout.current = setTimeout(async () => {
      const { data } = await supabase
        .from("courses")
        .select("id,name,city,country")
        .ilike("name", `%${courseQuery.trim()}%`)
        .limit(8);
      setCourseResults((data ?? []) as Course[]);
    }, 300);
  }, [courseQuery, selectedCourse]);

  async function selectCourse(course: Course) {
    setSelectedCourse(course);
    setCourseQuery(course.name);
    setCourseResults([]);
    setSelectedTeeBoxId("");
    setTeeBoxes([]);
    setTeeHoles([]);

    const { data } = await supabase
      .from("course_tee_boxes")
      .select("id,name,rating,slope,holes_count")
      .eq("course_id", course.id)
      .order("name");
    setTeeBoxes((data ?? []) as TeeBox[]);
  }

  async function selectTeeBox(id: string) {
    setSelectedTeeBoxId(id);
    const { data } = await supabase
      .from("course_tee_holes")
      .select("hole_number,par")
      .eq("tee_box_id", id)
      .order("hole_number");
    setTeeHoles((data ?? []) as TeeHole[]);
  }

  // ── Player search ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (playerSearchTimeout.current) clearTimeout(playerSearchTimeout.current);
    if (!playerQuery.trim()) { setPlayerResults([]); return; }
    playerSearchTimeout.current = setTimeout(async () => {
      const { data } = await supabase.rpc("search_profiles_public", {
        q: playerQuery.trim(),
        lim: 8,
      });
      const already = new Set(players.map((p) => p.profile_id));
      setPlayerResults(
        ((data ?? []) as ProfileResult[]).filter((p) => !already.has(p.id))
      );
    }, 300);
  }, [playerQuery, players]);

  function addPlayer(profile: ProfileResult) {
    setPlayers((prev) => [
      ...prev,
      { profile_id: profile.id, display_name: profile.name || profile.email || profile.id, handicap_index: "" },
    ]);
    setPlayerQuery("");
    setPlayerResults([]);
  }

  function removePlayer(profile_id: string) {
    setPlayers((prev) => prev.filter((p) => p.profile_id !== profile_id));
    setScores((prev) => {
      const next = { ...prev };
      delete next[profile_id];
      return next;
    });
  }

  function updateHI(profile_id: string, value: string) {
    setPlayers((prev) =>
      prev.map((p) => (p.profile_id === profile_id ? { ...p, handicap_index: value } : p))
    );
  }

  // ── Score entry ────────────────────────────────────────────────────────────

  function setScore(profile_id: string, hole: number, value: string) {
    setScores((prev) => ({
      ...prev,
      [profile_id]: { ...(prev[profile_id] ?? {}), [hole]: value },
    }));
  }

  function allScoresFilled() {
    if (!teeHoles.length || !players.length) return false;
    return players.every((p) =>
      teeHoles.every((h) => {
        const v = scores[p.profile_id]?.[h.hole_number];
        return v !== undefined && v !== "";
      })
    );
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  function step1Valid() {
    return playedAt && selectedCourse && selectedTeeBoxId && teeHoles.length > 0;
  }

  function step2Valid() {
    return players.length > 0;
  }

  function step3Valid() {
    return allScoresFilled();
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function onSubmit() {
    setSubmitting(true);
    setResult(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Not authenticated.");

      const scoresList: Array<{ profile_id: string; hole_number: number; strokes: number }> = [];
      for (const p of players) {
        for (const h of teeHoles) {
          scoresList.push({
            profile_id: p.profile_id,
            hole_number: h.hole_number,
            strokes: Number(scores[p.profile_id]?.[h.hole_number] ?? 0),
          });
        }
      }

      const res = await fetch("/api/admin/add-historical-round", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          played_at: playedAt,
          round_name: roundName.trim() || undefined,
          course_id: selectedCourse!.id,
          tee_box_id: selectedTeeBoxId,
          players: players.map((p) => ({
            profile_id: p.profile_id,
            handicap_index: p.handicap_index !== "" ? Number(p.handicap_index) : null,
          })),
          scores: scoresList,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Request failed");
      setResult(json);
      setStep(4); // success screen
    } catch (e: any) {
      setResult({ error: e?.message || String(e) });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const selectedTeeBox = teeBoxes.find((t) => t.id === selectedTeeBoxId) ?? null;

  function playerTotal(profile_id: string) {
    return teeHoles.reduce((sum, h) => sum + Number(scores[profile_id]?.[h.hole_number] ?? 0), 0);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (checking) {
    return (
      <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8">
        <div className="mx-auto w-full max-w-sm rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
          Checking admin access…
        </div>
      </div>
    );
  }

  if (!adminOk) return null;

  // Success screen
  if (step === 4) {
    return (
      <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8">
        <div className="mx-auto w-full max-w-lg space-y-4">
          <header className="flex items-center justify-between">
            <BackButton onClick={() => router.push("/admin")} />
            <div className="text-center flex-1">
              <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Add Historical Round</div>
            </div>
            <div className="w-[60px]" />
          </header>
          {result?.ok ? (
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-5 space-y-3">
              <div className="text-emerald-300 font-semibold">Round created successfully</div>
              <div className="text-xs text-emerald-100/60 break-all">Round ID: {result.round_id}</div>
              <div className="text-xs text-emerald-100/70">
                Handicap results and index history have been computed automatically.
              </div>
              <button
                onClick={() => { setStep(0); setResult(null); setPlayedAt(""); setRoundName(""); setCourseQuery(""); setSelectedCourse(null); setTeeBoxes([]); setSelectedTeeBoxId(""); setTeeHoles([]); setPlayers([]); setScores({}); }}
                className="rounded-xl bg-emerald-700/80 hover:bg-emerald-700 px-4 py-2 text-sm font-medium"
              >
                Add another round
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-red-900/70 bg-red-900/20 p-5">
              <div className="text-red-300 font-semibold mb-1">Error</div>
              <div className="text-sm text-red-100/80">{result?.error}</div>
              <button onClick={() => setStep(3)} className="mt-3 rounded-xl bg-black/30 border border-emerald-900/60 px-4 py-2 text-sm">
                Back to review
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-16">
      <div className="mx-auto w-full max-w-lg space-y-5">

        {/* Header */}
        <header className="flex items-center justify-between">
          <BackButton onClick={() => step > 0 ? setStep(step - 1) : router.push("/admin")} />
          <div className="text-center flex-1">
            <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Add Historical Round</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">Admin</div>
          </div>
          <div className="w-[60px]" />
        </header>

        {/* Step indicator */}
        <div className="flex gap-1.5 px-1">
          {STEPS.map((label, i) => (
            <div key={i} className="flex-1 space-y-1">
              <div className={`h-1 rounded-full ${i <= step ? "bg-emerald-500" : "bg-emerald-900/60"}`} />
              <div className={`text-[10px] text-center ${i === step ? "text-emerald-300" : "text-emerald-100/40"}`}>
                {label}
              </div>
            </div>
          ))}
        </div>

        {/* ── Step 0: Round Details ────────────────────────────────────────── */}
        {step === 0 && (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-5 space-y-4">
            <div className="space-y-1">
              <label className="text-xs text-emerald-100/60 uppercase tracking-wide">Played Date *</label>
              <input
                type="date"
                value={playedAt}
                onChange={(e) => setPlayedAt(e.target.value)}
                className="w-full rounded-xl bg-black/30 border border-emerald-900/60 px-3 py-2 text-base outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-emerald-100/60 uppercase tracking-wide">Round Name (optional)</label>
              <input
                type="text"
                placeholder="Defaults to course name"
                value={roundName}
                onChange={(e) => setRoundName(e.target.value)}
                className="w-full rounded-xl bg-black/30 border border-emerald-900/60 px-3 py-2 text-base outline-none placeholder:text-emerald-100/30"
              />
            </div>

            <div className="space-y-1 relative">
              <label className="text-xs text-emerald-100/60 uppercase tracking-wide">Course *</label>
              <input
                type="text"
                placeholder="Search by course name…"
                value={courseQuery}
                onChange={(e) => { setCourseQuery(e.target.value); if (selectedCourse) setSelectedCourse(null); }}
                className="w-full rounded-xl bg-black/30 border border-emerald-900/60 px-3 py-2 text-base outline-none placeholder:text-emerald-100/30"
              />
              {courseResults.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 rounded-xl border border-emerald-900/60 bg-[#0b3b21] shadow-lg overflow-hidden">
                  {courseResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectCourse(c)}
                      className="w-full text-left px-4 py-2.5 hover:bg-emerald-900/40 border-b border-emerald-900/30 last:border-0"
                    >
                      <div className="text-sm font-medium">{c.name}</div>
                      {(c.city || c.country) && (
                        <div className="text-xs text-emerald-100/50">{[c.city, c.country].filter(Boolean).join(", ")}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {teeBoxes.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs text-emerald-100/60 uppercase tracking-wide">Tee Box *</label>
                <select
                  value={selectedTeeBoxId}
                  onChange={(e) => selectTeeBox(e.target.value)}
                  className="w-full rounded-xl bg-black/30 border border-emerald-900/60 px-3 py-2 text-base outline-none"
                >
                  <option value="">Select tee…</option>
                  {teeBoxes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.rating && t.slope ? ` — ${t.rating}/${t.slope}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              disabled={!step1Valid()}
              onClick={() => setStep(1)}
              className="w-full rounded-xl bg-emerald-700/80 hover:bg-emerald-700 disabled:opacity-40 px-4 py-2.5 text-sm font-medium"
            >
              Next: Players
            </button>
          </div>
        )}

        {/* ── Step 1: Players ─────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-5 space-y-4">
            <div className="space-y-1 relative">
              <label className="text-xs text-emerald-100/60 uppercase tracking-wide">Search Players</label>
              <input
                type="text"
                placeholder="Search by name or email…"
                value={playerQuery}
                onChange={(e) => setPlayerQuery(e.target.value)}
                className="w-full rounded-xl bg-black/30 border border-emerald-900/60 px-3 py-2 text-base outline-none placeholder:text-emerald-100/30"
              />
              {playerResults.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 rounded-xl border border-emerald-900/60 bg-[#0b3b21] shadow-lg overflow-hidden">
                  {playerResults.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addPlayer(p)}
                      className="w-full text-left px-4 py-2.5 hover:bg-emerald-900/40 border-b border-emerald-900/30 last:border-0"
                    >
                      <div className="text-sm font-medium">{p.name || "(no name)"}</div>
                      {p.email && <div className="text-xs text-emerald-100/50">{p.email}</div>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {players.length > 0 && (
              <div className="space-y-2">
                {players.map((p) => (
                  <div key={p.profile_id} className="flex items-center gap-3 rounded-xl border border-emerald-900/50 bg-black/20 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.display_name}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs text-emerald-100/50">HI</span>
                      <input
                        type="number"
                        step="0.1"
                        min="-10"
                        max="54"
                        placeholder="—"
                        value={p.handicap_index}
                        onChange={(e) => updateHI(p.profile_id, e.target.value)}
                        className="w-16 rounded-lg bg-black/30 border border-emerald-900/60 px-2 py-1 text-sm text-center outline-none placeholder:text-emerald-100/30"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removePlayer(p.profile_id)}
                      className="text-emerald-100/40 hover:text-red-400 text-lg leading-none ml-1"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {players.length === 0 && (
              <div className="text-sm text-emerald-100/40 text-center py-2">No players added yet</div>
            )}

            <button
              type="button"
              disabled={!step2Valid()}
              onClick={() => setStep(2)}
              className="w-full rounded-xl bg-emerald-700/80 hover:bg-emerald-700 disabled:opacity-40 px-4 py-2.5 text-sm font-medium"
            >
              Next: Scores
            </button>
          </div>
        )}

        {/* ── Step 2: Scores ──────────────────────────────────────────────── */}
        {step === 2 && (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 space-y-4">
            <div className="text-xs text-emerald-100/50">
              {selectedCourse?.name} · {selectedTeeBox?.name} · {teeHoles.length} holes
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="text-left text-xs text-emerald-100/50 font-normal pb-2 pr-3 w-12">Hole</th>
                    <th className="text-center text-xs text-emerald-100/50 font-normal pb-2 pr-3 w-10">Par</th>
                    {players.map((p) => (
                      <th key={p.profile_id} className="text-center text-xs text-emerald-100/70 font-medium pb-2 px-1 min-w-[52px]">
                        {p.display_name.split(" ")[0]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {teeHoles.map((h) => (
                    <tr key={h.hole_number} className="border-t border-emerald-900/30">
                      <td className="text-xs text-emerald-100/60 py-1 pr-3">{h.hole_number}</td>
                      <td className="text-xs text-emerald-100/40 text-center py-1 pr-3">{h.par ?? "—"}</td>
                      {players.map((p) => (
                        <td key={p.profile_id} className="py-1 px-1">
                          <input
                            type="number"
                            min={0}
                            max={30}
                            value={scores[p.profile_id]?.[h.hole_number] ?? ""}
                            onChange={(e) => setScore(p.profile_id, h.hole_number, e.target.value)}
                            className="w-12 rounded-lg bg-black/30 border border-emerald-900/60 px-1 py-1 text-sm text-center outline-none"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t-2 border-emerald-700/50">
                    <td className="text-xs text-emerald-100/60 py-2 pr-3 font-medium">Total</td>
                    <td className="text-xs text-emerald-100/40 text-center py-2 pr-3">
                      {teeHoles.reduce((s, h) => s + (h.par ?? 0), 0) || "—"}
                    </td>
                    {players.map((p) => (
                      <td key={p.profile_id} className="text-center text-sm font-semibold py-2 px-1 text-emerald-200">
                        {allScoresFilled() ? playerTotal(p.profile_id) : "—"}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            <button
              type="button"
              disabled={!step3Valid()}
              onClick={() => setStep(3)}
              className="w-full rounded-xl bg-emerald-700/80 hover:bg-emerald-700 disabled:opacity-40 px-4 py-2.5 text-sm font-medium"
            >
              Next: Review
            </button>
          </div>
        )}

        {/* ── Step 3: Review & Submit ──────────────────────────────────────── */}
        {step === 3 && (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-5 space-y-4">
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-emerald-100/50">Date</span>
                <span>{playedAt}</span>
              </div>
              {roundName && (
                <div className="flex justify-between">
                  <span className="text-emerald-100/50">Name</span>
                  <span>{roundName}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-emerald-100/50">Course</span>
                <span>{selectedCourse?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-emerald-100/50">Tee</span>
                <span>
                  {selectedTeeBox?.name}
                  {selectedTeeBox?.rating && selectedTeeBox?.slope
                    ? ` (${selectedTeeBox.rating}/${selectedTeeBox.slope})`
                    : ""}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-emerald-100/50">Holes</span>
                <span>{teeHoles.length}</span>
              </div>
            </div>

            <div className="border-t border-emerald-900/40 pt-3 space-y-2">
              {players.map((p) => (
                <div key={p.profile_id} className="flex justify-between text-sm">
                  <span>
                    {p.display_name}
                    {p.handicap_index !== "" && (
                      <span className="text-emerald-100/40 ml-1.5">HI {p.handicap_index}</span>
                    )}
                  </span>
                  <span className="font-semibold text-emerald-200">{playerTotal(p.profile_id)}</span>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting}
              className="w-full rounded-xl bg-emerald-700/80 hover:bg-emerald-700 disabled:opacity-40 px-4 py-2.5 text-sm font-semibold"
            >
              {submitting ? "Submitting…" : "Submit Historical Round"}
            </button>

            {result?.error && (
              <div className="rounded-xl border border-red-900/60 bg-red-900/20 p-3 text-sm text-red-300">
                {result.error}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
