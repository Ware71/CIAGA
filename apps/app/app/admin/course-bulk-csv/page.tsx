"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export default function CourseBulkCsvPage() {
  const [adminKey, setAdminKey] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [out, setOut] = useState("");

  async function run() {
    setOut("");
    if (!file) {
      setOut("Pick a CSV file first.");
      return;
    }

    const text = await file.text();

    const res = await fetch("/api/admin/bulk-course-upsert-csv", {
      method: "POST",
      headers: {
        "content-type": "text/csv",
        "x-admin-key": adminKey,
      },
      body: text,
    });

    setOut(await res.text());
  }

  return (
    <div className="p-4 space-y-3 max-w-3xl">
      <h1 className="text-xl font-semibold">Bulk Course Updater (CSV)</h1>

      <div className="space-y-2">
        <label className="text-sm">Admin Key</label>
        <input
          className="w-full border rounded p-2"
          value={adminKey}
          onChange={(e) => setAdminKey(e.target.value)}
          placeholder="x-admin-key"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm">CSV File</label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <Button onClick={run}>Upload + Run</Button>

      <div className="space-y-2">
        <label className="text-sm">Response</label>
        <pre className="w-full border rounded p-2 text-xs overflow-auto">{out}</pre>
      </div>
    </div>
  );
}
