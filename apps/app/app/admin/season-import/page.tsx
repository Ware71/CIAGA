"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { BackButton } from "@/components/ui/BackButton";

type Group = { id: string; name: string };

type SeasonPreview = {
  season_name: string;
  year: number | null;
  start_date: string | null;
  end_date: string | null;
  already_exists: boolean;
};

type CompetitionPreview = {
  competition_id: string;
  competition_name: string;
  event_name: string;
  season_name: string;
  tee_box_id: string;
  entry_fee: number | null;
  player_count: number;
  score_row_count: number;
  already_imported: boolean;
};

type PreviewData = {
  group_id: string;
  seasons: SeasonPreview[];
  competitions: CompetitionPreview[];
  errors: string[];
  totals: {
    seasons_to_create: number;
    competitions: number;
    participants: number;
    score_events: number;
    fee_transactions: number;
  };
};

type ImportSummary = {
  seasons_created: string[];
  rounds_created: number;
  participants_created: number;
  members_enrolled: number;
  score_events_created: number;
  competition_entries_created: number;
  fee_transactions_created: number;
  skipped_already_imported: string[];
  competition_round_ids: Array<{ competition_name: string; event_name: string; competition_id: string; round_id: string }>;
};

async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("No session — please sign in again.");
  return token;
}

export default function SeasonImportPage() {
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [adminOk, setAdminOk] = useState(false);

  // Step 1: group selection
  const [groupQuery, setGroupQuery] = useState("");
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [groupSearching, setGroupSearching] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);

  // Step 2: file + preview
  const [file, setFile] = useState<File | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);

  const [groupInputFocused, setGroupInputFocused] = useState(false);

  // Step 3: import
  const [importLoading, setImportLoading] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [showRoundIds, setShowRoundIds] = useState(false);

  const filteredGroups = allGroups.filter(g =>
    !groupQuery.trim() || g.name.toLowerCase().includes(groupQuery.trim().toLowerCase())
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) { router.replace("/auth"); return; }
      const { data } = await supabase.from("profiles").select("is_admin").eq("owner_user_id", auth.user.id).limit(1);
      if (cancelled) return;
      if (!data?.[0]?.is_admin) { router.replace("/"); return; }
      setAdminOk(true);
      setChecking(false);
      // Load all groups via admin API (bypasses RLS)
      setGroupSearching(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (token && !cancelled) {
        const res = await fetch("/api/admin/season-import/groups", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!cancelled) {
          setAllGroups((json.groups ?? []) as Group[]);
          setGroupSearching(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  function selectGroup(g: Group) {
    setSelectedGroup(g);
    setGroupQuery(g.name);
    setGroupInputFocused(false);
    setFile(null);
    setPreview(null);
    setPreviewErrors([]);
    setImportSummary(null);
    setImportError(null);
    setTemplateError(null);
  }

  async function downloadTemplate() {
    if (!selectedGroup) return;
    setTemplateError(null);
    setTemplateLoading(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/admin/season-import/template?group_id=${selectedGroup.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || "Template generation failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `season-import-${selectedGroup.name.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setTemplateError(e?.message || String(e));
    } finally {
      setTemplateLoading(false);
    }
  }

  async function runPreview() {
    if (!file || !selectedGroup) return;
    setPreviewLoading(true);
    setPreview(null);
    setPreviewErrors([]);
    setImportSummary(null);
    setImportError(null);
    try {
      const token = await getAccessToken();
      const fd = new FormData();
      fd.append("file", file);
      fd.append("group_id", selectedGroup.id);
      const res = await fetch("/api/admin/season-import/preview", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Preview failed");
      const p: PreviewData = json.preview;
      if (p.errors?.length) {
        setPreviewErrors(p.errors);
      } else {
        setPreview(p);
      }
    } catch (e: any) {
      setPreviewErrors([e?.message || String(e)]);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function runImport() {
    if (!file || !selectedGroup || !preview) return;
    setImportLoading(true);
    setImportError(null);
    try {
      const token = await getAccessToken();
      const fd = new FormData();
      fd.append("file", file);
      fd.append("group_id", selectedGroup.id);
      const res = await fetch("/api/admin/season-import/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Import failed");
      setImportSummary(json.summary);
      setPreview(null);
    } catch (e: any) {
      setImportError(e?.message || String(e));
    } finally {
      setImportLoading(false);
    }
  }

  const canImport = !!preview && preview.errors.length === 0 && !importLoading && !importSummary;

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

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-16">
      <div className="mx-auto w-full max-w-3xl space-y-6">

        {/* Header */}
        <header className="flex items-center justify-between">
          <BackButton onClick={() => router.back()} />
          <div className="text-center flex-1">
            <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Season Import</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">Admin Tool</div>
          </div>
          <div className="w-[60px]" />
        </header>

        {/* Step 1: Select group */}
        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 space-y-3">
          <div className="text-sm font-semibold text-[#f5e6b0]">Step 1 — Select group</div>
          <div className="relative">
            <input
              className="w-full rounded-xl bg-black/30 border border-emerald-900/60 px-3 py-2 text-base outline-none placeholder:text-emerald-100/30"
              placeholder={groupSearching ? "Loading groups…" : "Search groups…"}
              value={groupQuery}
              onChange={(e) => { setGroupQuery(e.target.value); setSelectedGroup(null); }}
              onFocus={() => setGroupInputFocused(true)}
              onBlur={() => setTimeout(() => setGroupInputFocused(false), 150)}
            />
            {groupInputFocused && !selectedGroup && filteredGroups.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-xl border border-emerald-900/70 bg-[#0b3b21] shadow-lg overflow-hidden max-h-64 overflow-y-auto">
                {filteredGroups.map(g => (
                  <button
                    key={g.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectGroup(g)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-900/40 transition-colors"
                  >
                    {g.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedGroup && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm text-emerald-100/70">
                Selected: <span className="font-semibold text-emerald-100">{selectedGroup.name}</span>
                <span className="ml-2 text-xs font-mono text-emerald-100/40">{selectedGroup.id}</span>
              </div>
              <button
                type="button"
                onClick={downloadTemplate}
                disabled={templateLoading}
                className="rounded-xl bg-emerald-700/80 hover:bg-emerald-700 px-4 py-2 text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {templateLoading ? "Generating…" : "Download Excel Template (.xlsx)"}
              </button>
            </div>
          )}
          {templateError && (
            <div className="text-sm text-red-400">{templateError}</div>
          )}
          {selectedGroup && (
            <div className="text-xs text-emerald-100/50 space-y-0.5">
              <p>The template contains all competitions and active members for this group as lookup data.</p>
              <p>Fill the <span className="text-[#92D050] font-medium">Competitions</span> and <span className="text-[#92D050] font-medium">Scores</span> sheets, then upload below.</p>
            </div>
          )}
        </div>

        {/* Step 2: Upload + preview */}
        {selectedGroup && (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 space-y-3">
            <div className="text-sm font-semibold text-[#f5e6b0]">Step 2 — Upload &amp; Preview</div>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="text-sm text-emerald-100/80"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
                setPreviewErrors([]);
                setImportSummary(null);
                setImportError(null);
              }}
            />
            <button
              type="button"
              onClick={runPreview}
              disabled={!file || previewLoading}
              className="rounded-xl bg-emerald-700/80 hover:bg-emerald-700 px-4 py-2 text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {previewLoading ? "Validating…" : "Preview / Validate"}
            </button>

            {/* Validation errors */}
            {previewErrors.length > 0 && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 space-y-1">
                <div className="text-sm font-semibold text-red-400">
                  {previewErrors.length} error{previewErrors.length !== 1 ? "s" : ""} — fix before importing
                </div>
                <ul className="list-disc ml-4 text-xs text-red-300 space-y-0.5">
                  {previewErrors.slice(0, 50).map((e, i) => <li key={i}>{e}</li>)}
                </ul>
                {previewErrors.length > 50 && (
                  <div className="text-xs text-red-300/70">…and {previewErrors.length - 50} more</div>
                )}
              </div>
            )}

            {/* Preview success */}
            {preview && !importSummary && (
              <div className="rounded-xl border border-emerald-700/40 bg-emerald-900/20 p-3 space-y-4">
                <div className="text-sm font-semibold text-emerald-300">Preview looks good</div>
                <div className="flex flex-wrap gap-4 text-sm">
                  <span><span className="font-semibold text-white">{preview.totals.seasons_to_create}</span> seasons to create</span>
                  <span><span className="font-semibold text-white">{preview.totals.competitions}</span> competitions</span>
                  <span><span className="font-semibold text-white">{preview.totals.participants}</span> participant rows</span>
                  <span><span className="font-semibold text-white">{preview.totals.score_events}</span> score events</span>
                  <span><span className="font-semibold text-white">{preview.totals.fee_transactions}</span> fee transactions</span>
                </div>

                {/* Seasons */}
                {preview.seasons.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-emerald-100/60 mb-1">Seasons</div>
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="text-emerald-100/50">
                          <th className="text-left py-1 pr-3">Season Name</th>
                          <th className="text-right py-1 pr-3">Year</th>
                          <th className="text-right py-1 pr-3">Start</th>
                          <th className="text-right py-1">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.seasons.map(s => (
                          <tr key={s.season_name} className="border-t border-emerald-900/40">
                            <td className="py-1 pr-3 text-emerald-100">{s.season_name}</td>
                            <td className="text-right py-1 pr-3 text-emerald-100/70">{s.year ?? "—"}</td>
                            <td className="text-right py-1 pr-3 text-emerald-100/70">{s.start_date ?? "—"}</td>
                            <td className="text-right py-1">
                              {s.already_exists
                                ? <span className="text-amber-400">Exists (reuse)</span>
                                : <span className="text-emerald-400">New</span>
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Competitions */}
                <div>
                  <div className="text-xs font-semibold text-emerald-100/60 mb-1">Competitions</div>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="text-emerald-100/50">
                        <th className="text-left py-1 pr-3">Event Name</th>
                        <th className="text-left py-1 pr-3">Season</th>
                        <th className="text-right py-1 pr-3">Players</th>
                        <th className="text-right py-1 pr-3">Fee</th>
                        <th className="text-right py-1">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.competitions.map(c => (
                        <tr key={c.competition_id} className="border-t border-emerald-900/40">
                          <td className="py-1 pr-3 text-emerald-100">{c.event_name}</td>
                          <td className="py-1 pr-3 text-emerald-100/70">{c.season_name || "—"}</td>
                          <td className="text-right py-1 pr-3 text-emerald-100/80">{c.player_count}</td>
                          <td className="text-right py-1 pr-3 text-emerald-100/80">
                            {c.entry_fee != null ? `£${c.entry_fee.toFixed(2)}` : "—"}
                          </td>
                          <td className="text-right py-1">
                            {c.already_imported
                              ? <span className="text-amber-400 font-medium">Skip</span>
                              : <span className="text-emerald-400 font-medium">Ready</span>
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Confirm import */}
        {preview && !importSummary && (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 space-y-3">
            <div className="text-sm font-semibold text-[#f5e6b0]">Step 3 — Confirm Import</div>
            <div className="text-sm text-emerald-100/70">
              This will create rounds, score events, competition entries, and entry fee transactions. This action cannot be undone from the UI.
            </div>
            <button
              type="button"
              onClick={runImport}
              disabled={!canImport}
              className="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-5 py-2.5 text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {importLoading ? "Importing…" : "Confirm Import"}
            </button>
            {importError && (
              <div className="text-sm text-red-400">{importError}</div>
            )}
          </div>
        )}

        {/* Import complete */}
        {importSummary && (
          <div className="rounded-2xl border border-emerald-700/50 bg-emerald-900/20 p-4 space-y-3">
            <div className="text-sm font-semibold text-emerald-300">Import complete</div>
            <div className="flex flex-wrap gap-4 text-sm">
              {importSummary.seasons_created.length > 0 && (
                <span><span className="font-semibold text-white">{importSummary.seasons_created.length}</span> seasons created</span>
              )}
              <span><span className="font-semibold text-white">{importSummary.rounds_created}</span> rounds</span>
              <span><span className="font-semibold text-white">{importSummary.participants_created}</span> participants</span>
              {importSummary.members_enrolled > 0 && (
                <span><span className="font-semibold text-white">{importSummary.members_enrolled}</span> members enrolled</span>
              )}
              <span><span className="font-semibold text-white">{importSummary.score_events_created}</span> score events</span>
              <span><span className="font-semibold text-white">{importSummary.competition_entries_created}</span> competition entries</span>
              <span><span className="font-semibold text-white">{importSummary.fee_transactions_created}</span> fee transactions</span>
            </div>

            {importSummary.skipped_already_imported.length > 0 && (
              <div className="text-xs text-amber-400">
                Skipped (already imported): {importSummary.skipped_already_imported.join(", ")}
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowRoundIds(v => !v)}
              className="text-xs text-emerald-100/50 underline"
            >
              {showRoundIds ? "Hide" : "Show"} round IDs
            </button>

            {showRoundIds && (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-emerald-100/60">
                    <th className="text-left py-1 pr-3">Competition</th>
                    <th className="text-left py-1 pr-3">Competition ID</th>
                    <th className="text-left py-1">Round ID</th>
                  </tr>
                </thead>
                <tbody>
                  {importSummary.competition_round_ids.map(r => (
                    <tr key={r.round_id} className="border-t border-emerald-900/40">
                      <td className="py-1 pr-3 text-emerald-100">{r.event_name}</td>
                      <td className="py-1 pr-3 font-mono text-emerald-100/60 break-all">{r.competition_id}</td>
                      <td className="py-1 font-mono text-emerald-100/60 break-all">{r.round_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
