// /app/round/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

function ConfirmSheet(props: {
  title: string;
  subtitle?: string;
  confirmLabel: string;
  confirmDisabled?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const { title, subtitle, confirmLabel, confirmDisabled, onConfirm, onClose } = props;

  return (
    <div className="fixed inset-0 z-50">
      <button className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="Close" />
      <div className="absolute left-0 right-0 bottom-0 px-3 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-[520px] rounded-t-3xl border border-emerald-900/70 bg-[#061f12] shadow-2xl overflow-hidden">
          <div className="p-4 border-b border-emerald-900/60">
            <div className="text-sm font-semibold text-emerald-50">{title}</div>
            {subtitle ? <div className="text-[11px] text-emerald-100/70 mt-1">{subtitle}</div> : null}
          </div>

          <div className="p-4 flex gap-2">
            <Button
              variant="ghost"
              className="flex-1 rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/40 text-emerald-50 hover:bg-emerald-900/20"
              onClick={onClose}
              disabled={!!confirmDisabled}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 rounded-2xl bg-red-500 text-white hover:bg-red-600 disabled:opacity-60"
              onClick={onConfirm}
              disabled={!!confirmDisabled}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SwipeToDeleteRow(props: {
    children: React.ReactNode;
    enabled: boolean;
    onDelete: () => void;
    deleting?: boolean;
  }) {
    const { children, enabled, onDelete, deleting } = props;

    const maxReveal = 96; // px
    const threshold = 12; // px before we decide direction
    const openThreshold = 48; // px to snap open

    const [x, setX] = useState(0);
    const [open, setOpen] = useState(false);
    const [dragging, setDragging] = useState(false);

    const start = useRef<{ x: number; y: number } | null>(null);
    const locked = useRef<"none" | "h" | "v">("none");

    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

    function close() {
      setOpen(false);
      setX(0);
    }

    function onPointerDown(e: React.PointerEvent) {
      if (!enabled) return;

      start.current = { x: e.clientX, y: e.clientY };
      locked.current = "none";
      setDragging(true);

      // Important: capture so we keep getting moves even if finger leaves element
      (e.currentTarget as any).setPointerCapture?.(e.pointerId);
    }

    function onPointerMove(e: React.PointerEvent) {
      if (!enabled) return;
      if (!start.current) return;

      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;

      // Decide direction (lock)
      if (locked.current === "none") {
        if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy)) {
          locked.current = "h";
        } else if (Math.abs(dy) > threshold && Math.abs(dy) > Math.abs(dx)) {
          locked.current = "v";
        } else {
          return;
        }
      }

      // If vertical scroll, do nothing (let the page scroll)
      if (locked.current === "v") return;

      // Horizontal swipe: stop the browser from scrolling vertically
      e.preventDefault();

      // Only allow swipe left
      const next = clamp(dx, -maxReveal, 0);
      setX(next);
    }

    function onPointerUp() {
      if (!enabled) return;

      setDragging(false);

      // If we never locked to horizontal, keep existing state
      if (locked.current !== "h") {
        start.current = null;
        locked.current = "none";
        return;
      }

      const shouldOpen = x < -openThreshold;
      setOpen(shouldOpen);
      setX(shouldOpen ? -maxReveal : 0);

      start.current = null;
      locked.current = "none";
    }

    const showRail = enabled && (open || dragging || x < 0);

    return (
      <div className="relative rounded-2xl overflow-hidden">
        {/* Rail: hidden unless swiping/open */}
        <div
          className={[
            "absolute inset-y-0 right-0 w-[96px] flex items-stretch transition-opacity",
            showRail ? "opacity-100" : "opacity-0 pointer-events-none",
          ].join(" ")}
        >
          <button
            className="w-full bg-red-600 text-white text-sm font-semibold"
            onClick={() => {
              close();
              onDelete();
            }}
            disabled={!!deleting}
          >
            {deleting ? "…" : "Delete"}
          </button>
        </div>

        {/* Foreground */}
        <div
          // Key: let the browser know vertical pan is allowed, horizontal is handled by us
          style={{ transform: `translateX(${x}px)`, touchAction: enabled ? "pan-y" : "auto" }}
          className="will-change-transform"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {/* If row is open and user taps it, close instead of navigating */}
          <div
            onClickCapture={(e) => {
              if (open) {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
            }}
          >
            {children}
          </div>
        </div>
      </div>
    );
  }


export default function RoundHomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<ParticipantRow[]>([]);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

      const myProfileId = await getMyProfileIdByAuthUserId(auth.user.id);

      const { data, error } = await supabase
        .from("round_participants")
        .select("id, role, round:rounds(id,name,status,started_at,created_at,course_id, courses(name))")
        .eq("profile_id", myProfileId)
        .order("created_at", { ascending: false, referencedTable: "rounds" as any });

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

  async function deleteDraft(roundId: string) {
    setErr(null);
    setDeletingId(roundId);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Not authenticated.");

      const res = await fetch("/api/rounds/delete-draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ round_id: roundId }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);

      // Optimistic remove from UI
      setRows((prev) => prev.filter((p) => p.round?.id !== roundId));
    } catch (e: any) {
      setErr(e?.message || "Failed to delete draft");
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-6">
        <header className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="px-2 text-emerald-100 hover:bg-emerald-900/30"
            onClick={() => router.replace("/")}
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
            {rounds.map((r) => {
              const isDraft = r.status === "draft";
              const isDeleting = deletingId === r.id;

              const card = (
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
                      {isDraft ? (
                        <div className="mt-1 text-[10px] text-emerald-100/50">Swipe left to delete draft</div>
                      ) : null}
                    </div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/70">{r.status}</div>
                  </div>
                </Link>
              );

              // Only drafts get swipe delete
              return (
                <SwipeToDeleteRow
                  key={r.id}
                  enabled={isDraft}
                  deleting={isDeleting}
                  onDelete={() => setConfirmDeleteId(r.id)}
                >
                  {card}
                </SwipeToDeleteRow>
              );
            })}
          </div>
        )}

        {confirmDeleteId ? (
          <ConfirmSheet
            title="Delete draft round?"
            subtitle="This removes the draft and any related data from the database."
            confirmLabel={deletingId === confirmDeleteId ? "Deleting…" : "Delete"}
            confirmDisabled={deletingId === confirmDeleteId}
            onClose={() => setConfirmDeleteId(null)}
            onConfirm={() => deleteDraft(confirmDeleteId)}
          />
        ) : null}
      </div>
    </div>
  );
}
