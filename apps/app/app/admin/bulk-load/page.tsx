"use client";

import { useState } from "react";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";

type ParsedRow = Record<string, string>;

type PreviewResult = {
  rows: number;
  rounds: number;
  participants_est: number;
  score_events_est: number;
  invalid_course_ids: string[];
  invalid_tee_box_ids: string[];
  unresolved_emails: string[];
  course_names: Record<string, string>;
};

type ImportSummary = {
  rounds_created: number;
  participants_created: number;
  score_events_created: number;
  round_keys: Array<{ round_key: string; round_id: string }>;
};

async function downloadExcelTemplate(token: string) {
  const res = await fetch("/api/admin/bulk-load/template", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error || "Failed to generate template");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "bulk-rounds-template.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}

function validateRows(rows: ParsedRow[]) {
  const errs: string[] = [];
  const required = ["round_key", "course_id", "played_at", "tee_box_id", "hole_number", "strokes"];

  rows.forEach((r, idx) => {
    required.forEach((k) => {
      if (!r[k]) errs.push(`Row ${idx + 2}: missing ${k}`);
    });

    const isGuest = (r["is_guest"] || "").toLowerCase() === "true";
    if (!r["player_email"] && !r["profile_id"] && !isGuest) {
      errs.push(`Row ${idx + 2}: need player_email or profile_id (or is_guest=true)`);
    }

    const hole = Number(r["hole_number"]);
    if (!Number.isInteger(hole) || hole < 1 || hole > 18) {
      errs.push(`Row ${idx + 2}: hole_number must be integer 1-18`);
    }
    const strokes = Number(r["strokes"]);
    if (!Number.isInteger(strokes) || strokes < 0 || strokes > 30) {
      errs.push(`Row ${idx + 2}: strokes must be an integer (0-30)`);
    }
  });

  return errs;
}

async function getAccessToken() {
  const { data: sessionData, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("No session access token.");
  return token;
}

async function requireAdminOrThrow() {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) throw new Error("Not signed in.");
  const { data: prof, error } = await supabase
    .from("profiles")
    .select("id,is_admin")
    .eq("owner_user_id", auth.user.id)
    .single();
  if (error) throw error;
  if (!prof?.is_admin) throw new Error("Admin only.");
}

export default function AdminBulkLoadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [showRoundKeys, setShowRoundKeys] = useState(false);

  function reset() {
    setErrors([]);
    setPreview(null);
    setImportSummary(null);
    setShowRoundKeys(false);
  }

  async function onPreview() {
    reset();
    if (!file) return;
    setLoading(true);

    try {
      const text = await file.text();
      const parsed = Papa.parse<ParsedRow>(text, { header: true, skipEmptyLines: true });

      if (parsed.errors?.length) {
        setErrors(parsed.errors.map((e) => e.message));
        return;
      }

      const rows = (parsed.data || []).filter(Boolean);
      const clientErrs = validateRows(rows);
      if (clientErrs.length) {
        setErrors(clientErrs);
        return;
      }

      await requireAdminOrThrow();
      const token = await getAccessToken();

      const fd = new FormData();
      fd.append("file", file);
      fd.append("preview", "true");

      const res = await fetch("/api/admin/bulk-load", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Preview failed.");

      const p: PreviewResult = json.preview;
      const serverErrs: string[] = [];
      for (const id of p.invalid_course_ids) serverErrs.push(`Unknown course_id: ${id}`);
      for (const id of p.invalid_tee_box_ids) serverErrs.push(`Unknown tee_box_id: ${id}`);
      for (const e of p.unresolved_emails) serverErrs.push(`Email not found in profiles: ${e}`);

      if (serverErrs.length) {
        setErrors(serverErrs);
      } else {
        setPreview(p);
      }
    } catch (e: any) {
      setErrors([e?.message || String(e)]);
    } finally {
      setLoading(false);
    }
  }

  async function onUpload() {
    setLoading(true);
    setImportSummary(null);

    try {
      await requireAdminOrThrow();
      if (!file) throw new Error("Choose a CSV file first.");

      const token = await getAccessToken();

      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/admin/bulk-load", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Upload failed.");

      setPreview(null);
      setImportSummary(json.summary);
    } catch (e: any) {
      setErrors([e?.message || String(e)]);
    } finally {
      setLoading(false);
    }
  }

  const canUpload = !!file && !loading && errors.length === 0 && !!preview && !importSummary;

  async function onDownloadTemplate() {
    setTemplateError(null);
    setTemplateLoading(true);
    try {
      const token = await getAccessToken();
      await downloadExcelTemplate(token);
    } catch (e: any) {
      setTemplateError(e?.message || String(e));
    } finally {
      setTemplateLoading(false);
    }
  }

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold">Admin: Bulk Load Rounds (CSV)</h1>

      {/* CSV Format Guide */}
      <details className="rounded border p-3 text-sm">
        <summary className="cursor-pointer font-medium">CSV Format Guide &amp; Excel Template</summary>
        <div className="mt-3 space-y-4">

          {/* Template download */}
          <div className="space-y-1">
            <Button
              variant="outline"
              size="sm"
              onClick={onDownloadTemplate}
              disabled={templateLoading}
            >
              {templateLoading ? "Generating…" : "Download Excel Template (.xlsx)"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Requires Excel 365 or Excel 2019+. The template includes a Guide sheet with full instructions.
              Fill the coloured columns, then save as CSV (UTF-8) before uploading here.
            </p>
            {templateError && (
              <p className="text-xs text-destructive">{templateError}</p>
            )}
          </div>

          {/* Colour legend */}
          <div>
            <div className="font-medium mb-1">Column colour legend</div>
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-sm flex-shrink-0" style={{ background: "#92D050" }} />
                <span><strong>Green</strong> — you must fill these in (mandatory)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-sm flex-shrink-0" style={{ background: "#FFC000" }} />
                <span><strong>Amber</strong> — optional, leave blank to use the default</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-sm flex-shrink-0" style={{ background: "#FF6B6B" }} />
                <span><strong>Red</strong> — auto-filled by formula, do not type in these cells</span>
              </div>
            </div>
          </div>

          {/* Required columns */}
          <div>
            <div className="font-medium mb-1">Required columns <span className="text-xs font-normal text-muted-foreground">(green in template)</span></div>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-muted">
                  <th className="border px-2 py-1 text-left">Column</th>
                  <th className="border px-2 py-1 text-left">Description</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Player Name or Email", "Full name or email matching a registered profile"],
                  ["Course Name", "Exact course name — auto-resolves course_id via XLOOKUP"],
                  ["Tee Name", "Tee colour/name for the course — auto-resolves tee_box_id"],
                  ["hole_number", "Integer 1–18"],
                  ["strokes", "Integer 0–30"],
                  ["round_key", "Unique code grouping all rows into one round (e.g. round_001)"],
                  ["played_at", "Date in YYYY-MM-DD format (e.g. 2024-06-15)"],
                ].map(([col, desc]) => (
                  <tr key={col}>
                    <td className="border px-2 py-1 font-mono">{col}</td>
                    <td className="border px-2 py-1">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Optional columns */}
          <div>
            <div className="font-medium mb-1">Optional columns <span className="text-xs font-normal text-muted-foreground">(amber in template)</span></div>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-muted">
                  <th className="border px-2 py-1 text-left">Column</th>
                  <th className="border px-2 py-1 text-left">Description</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["handicap_index", "Player handicap index at time of round"],
                  ["role", "player | scorer | owner (default: player)"],
                  ["status", "draft | live | finished (default: finished)"],
                  ["visibility", "private | link | public (default: private)"],
                ].map(([col, desc]) => (
                  <tr key={col}>
                    <td className="border px-2 py-1 font-mono">{col}</td>
                    <td className="border px-2 py-1">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Auto-formula columns */}
          <div>
            <div className="font-medium mb-1">Auto-formula columns <span className="text-xs font-normal text-muted-foreground">(red in template — do not edit)</span></div>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-muted">
                  <th className="border px-2 py-1 text-left">Column</th>
                  <th className="border px-2 py-1 text-left">Resolved from</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["profile_id", "Player Name or Email (XLOOKUP against registered profiles)"],
                  ["display_name", "Player Name or Email (XLOOKUP)"],
                  ["course_id", "Course Name (XLOOKUP against courses)"],
                  ["round_name", "Course Name + played_at (auto-generated label)"],
                  ["tee_box_id", "Course Name + Tee Name (composite XLOOKUP)"],
                ].map(([col, desc]) => (
                  <tr key={col}>
                    <td className="border px-2 py-1 font-mono">{col}</td>
                    <td className="border px-2 py-1">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tips */}
          <div className="text-xs text-muted-foreground space-y-1 border-t pt-2">
            <p><strong>Tip:</strong> All 18 holes × all players in one round share the same <code>round_key</code>.</p>
            <p><strong>Tip:</strong> If a red formula cell is blank, the name/email in the green column doesn&apos;t match the database — check spelling.</p>
            <p><strong>Tip:</strong> The lookup data in the template is from the same environment the import writes to.</p>
          </div>
        </div>
      </details>

      {/* File picker + actions */}
      <div className="space-y-3">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            reset();
          }}
        />
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onPreview} disabled={!file || loading}>
            {loading && !importSummary ? "Validating…" : "Preview / Validate"}
          </Button>
          <Button onClick={onUpload} disabled={!canUpload}>
            {loading && !!importSummary ? "Uploading…" : "Upload + Import"}
          </Button>
        </div>
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="rounded border border-destructive/40 bg-destructive/5 p-3">
          <div className="font-medium text-destructive mb-2">
            {errors.length} error{errors.length !== 1 ? "s" : ""} — fix before uploading
          </div>
          <ul className="list-disc ml-5 text-sm space-y-1">
            {errors.slice(0, 100).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          {errors.length > 100 && (
            <div className="text-sm mt-2 text-muted-foreground">…and {errors.length - 100} more</div>
          )}
        </div>
      )}

      {/* Preview success */}
      {preview && !importSummary && (
        <div className="rounded border border-border bg-muted/40 p-4 space-y-3">
          <div className="font-medium">Preview looks good — ready to import</div>
          <div className="flex gap-4 text-sm">
            <span><strong>{preview.rounds}</strong> rounds</span>
            <span><strong>~{preview.participants_est}</strong> participants</span>
            <span><strong>{preview.score_events_est}</strong> score rows</span>
          </div>
          {Object.keys(preview.course_names).length > 0 && (
            <div className="text-sm space-y-1">
              <div className="font-medium text-muted-foreground">Courses</div>
              {Object.entries(preview.course_names).map(([id, name]) => (
                <div key={id} className="font-mono text-xs">{name} <span className="text-muted-foreground">({id})</span></div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Import success */}
      {importSummary && (
        <div className="rounded border border-green-500/40 bg-green-500/5 p-4 space-y-3">
          <div className="font-medium text-green-700 dark:text-green-400">Import complete</div>
          <div className="flex gap-4 text-sm">
            <span><strong>{importSummary.rounds_created}</strong> rounds</span>
            <span><strong>{importSummary.participants_created}</strong> participants</span>
            <span><strong>{importSummary.score_events_created}</strong> score events</span>
          </div>
          <button
            className="text-xs text-muted-foreground underline"
            onClick={() => setShowRoundKeys((v) => !v)}
          >
            {showRoundKeys ? "Hide" : "Show"} round IDs
          </button>
          {showRoundKeys && (
            <table className="w-full text-xs border-collapse mt-1">
              <thead>
                <tr className="bg-muted">
                  <th className="border px-2 py-1 text-left">round_key</th>
                  <th className="border px-2 py-1 text-left">round_id</th>
                </tr>
              </thead>
              <tbody>
                {importSummary.round_keys.map(({ round_key, round_id }) => (
                  <tr key={round_id}>
                    <td className="border px-2 py-1 font-mono">{round_key}</td>
                    <td className="border px-2 py-1 font-mono">{round_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
