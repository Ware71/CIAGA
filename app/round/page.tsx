// /app/round/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";
import { Button } from "@/components/ui/button";

type RoundRow = {
  id: string;
  name: string | null;
  status: "draft" | "live" | "finished";
  started_at: string | null;
  created_at: string;
  course_id: string | null;
  courses?: { name: string | null } | null;
};

type ParticipantRow = {
  id: string;
  role: "owner" | "scorer" | "player";
  round: RoundRow;
};

export default function RoundHomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<ParticipantRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.replace("/auth");
        return;
      }

      // Model B: resolve my canonical profile id
      const myProfileId = await getMyProfileIdByAuthUserId(auth.user.id);

      const { data, error } = await supabase
        .from("round_participants")
        .select("id, role, round:rounds(id,name,status,started_at,created_at,course_id, courses(name))")
        .eq("profile_id", myProfileId)
        .order("created_at", { ascending: false, foreignTable: "rounds" });

      if (cancelled) return;

      if (error) {
        setErr(error.message);
        setRows([]);
      } else {
        setRows((data ?? []) as any);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const rounds = useMemo(() => {
    return rows
      .map((r) => r.round)
      .filter(Boolean)
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  }, [rows]);

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-6">
        <header className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="px-2 text-emerald-100 hover:bg-emerald-900/30"
            onClick={() => router.back()}
          >
            ← Back
          </Button>

          <div className="text-center flex-1">
            <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Rounds</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">Live scorecards</div>
          </div>

          <div className="w-[60px]" />
        </header>

        <Button
          className="w-full rounded-2xl bg-[#f5e6b0] text-[#042713] hover:bg-[#e9d79c]"
          onClick={() => router.push("/round/new")}
        >
          + New round
        </Button>

        {loading ? (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
            Loading…
          </div>
        ) : err ? (
          <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-100">{err}</div>
        ) : rounds.length === 0 ? (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-6 text-center space-y-2">
            <div className="text-sm font-semibold text-emerald-50">No rounds yet</div>
            <p className="text-[11px] text-emerald-100/70 leading-relaxed">Create a round to start a live scorecard.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rounds.map((r) => (
              <Link
                key={r.id}
                href={`/round/${r.id}`}
                className="block rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 hover:bg-[#0b3b21]/90"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-emerald-50">
                      {r.name || r.courses?.name || "Round"}
                    </div>
                    <div className="text-[11px] text-emerald-100/70">
                      {(r.courses?.name && r.name ? r.courses?.name : null) ||
                        (r.status === "live" ? "Live" : r.status === "finished" ? "Finished" : "Draft")}
                    </div>
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/70">{r.status}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
