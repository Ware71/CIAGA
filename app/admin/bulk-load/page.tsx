"use client";

import { useState } from "react";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";

type ParsedRow = Record<string, string>;

export default function AdminBulkLoadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

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

  function validateRows(rows: ParsedRow[]) {
    const errs: string[] = [];

    // Required base columns
    const required = ["round_key", "course_id", "played_at", "tee_box_id", "hole_number", "strokes"];

    rows.forEach((r, idx) => {
      required.forEach((k) => {
        if (!r[k]) errs.push(`Row ${idx + 2}: missing ${k}`);
      });

      // player identity: profile_id OR player_email OR guest
      const isGuest = (r["is_guest"] || "").toLowerCase() === "true";
      if (!r["player_email"] && !r["profile_id"] && !isGuest) {
        errs.push(`Row ${idx + 2}: need player_email or profile_id (or is_guest=true)`);
      }

      // basic numeric checks
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

  async function onPreview() {
    setPreviewErrors([]);
    setResult(null);
    if (!file) return;

    const text = await file.text();
    const parsed = Papa.parse<ParsedRow>(text, { header: true, skipEmptyLines: true });

    if (parsed.errors?.length) {
      setPreviewErrors(parsed.errors.map((e) => e.message));
      return;
    }

    const rows = (parsed.data || []).filter(Boolean);
    const errs = validateRows(rows);
    setPreviewErrors(errs);

    if (!errs.length) {
      // tiny summary
      const roundKeys = new Set(rows.map((r) => r.round_key).filter(Boolean));
      setResult({
        ok: true,
        preview: {
          rows: rows.length,
          rounds: roundKeys.size,
          example_round_keys: Array.from(roundKeys).slice(0, 10),
        },
      });
    }
  }

  async function onUpload() {
    setLoading(true);
    setResult(null);

    try {
      await requireAdminOrThrow();
      if (!file) throw new Error("Choose a CSV file first.");

      // ✅ Send bearer token for server verification
      const { data: sessionData, error: sErr } = await supabase.auth.getSession();
      if (sErr) throw sErr;
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("No session access token.");

      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/admin/bulk-load", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: fd,
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Upload failed.");
      setResult(json);
    } catch (e: any) {
      setResult({ error: e?.message || String(e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold">Admin: Bulk Load Rounds (CSV)</h1>

      <div className="space-y-2">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />

        <div className="flex gap-2">
          <Button variant="secondary" onClick={onPreview} disabled={!file || loading}>
            Preview / Validate
          </Button>
          <Button onClick={onUpload} disabled={!file || loading || previewErrors.length > 0}>
            {loading ? "Uploading..." : "Upload + Import"}
          </Button>
        </div>
      </div>

      {previewErrors.length > 0 && (
        <div className="rounded border p-3">
          <div className="font-medium mb-2">Validation errors</div>
          <ul className="list-disc ml-5 text-sm space-y-1">
            {previewErrors.slice(0, 100).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          {previewErrors.length > 100 && (
            <div className="text-sm mt-2">…and {previewErrors.length - 100} more</div>
          )}
        </div>
      )}

      {result && (
        <pre className="rounded bg-muted p-3 text-xs overflow-auto">{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}
