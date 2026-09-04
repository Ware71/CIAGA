"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { CARD, PageHeader, Tag } from "@/components/ui/chrome";

type Report = {
  id: string;
  target_type: "feed_item" | "comment";
  target_id: string;
  reason: string;
  reason_code: string | null;
  status: "open" | "reviewing" | "actioned" | "dismissed";
  created_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
  reporter: { profile_id: string; display_name: string };
  report_count: number;
  target:
    | {
        exists: true;
        visibility: string;
        author: string;
        author_profile_id: string | null;
        preview: string;
        href: string;
      }
    | { exists: false };
};

const TABS = [
  { key: "open", label: "Open" },
  { key: "reviewing", label: "Reviewing" },
  { key: "actioned", label: "Actioned" },
  { key: "dismissed", label: "Dismissed" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** Reports at or above this many distinct reporters sort to the top and get a
 *  warning flag. We alert rather than auto-hide: in a society of a few hundred,
 *  three friends agreeing shouldn't be enough to silence someone. */
const ESCALATION_THRESHOLD = 3;

async function authToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export default function AdminReportsPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<TabKey>("open");
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async (status: TabKey) => {
    setLoading(true);
    setMsg(null);
    try {
      const token = await authToken();
      if (!token) return;
      const res = await fetch(`/api/admin/reports?status=${status}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setReports(json.reports ?? []);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.replace("/auth");
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("owner_user_id", auth.user.id)
        .limit(1);
      if (cancelled) return;
      if (!data?.[0]?.is_admin) {
        router.replace("/");
        return;
      }
      setChecking(false);
      await refresh(tab);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, refresh]);

  async function moderate(report: Report, action: "hide" | "remove" | "restore") {
    setBusyId(report.id);
    setMsg(null);
    try {
      const token = await authToken();
      const res = await fetch("/api/admin/moderation", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          target_type: report.target_type,
          target_id: report.target_id,
          action,
          report_id: report.id,
          reason: report.reason_code ?? report.reason,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      await refresh(tab);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(report: Report, status: "reviewing" | "dismissed") {
    setBusyId(report.id);
    setMsg(null);
    try {
      const token = await authToken();
      const res = await fetch(`/api/admin/reports/${report.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      await refresh(tab);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  }

  function switchTab(next: TabKey) {
    setTab(next);
    void refresh(next);
  }

  if (checking) return null;

  // Most-reported first, then newest.
  const sorted = [...reports].sort(
    (a, b) =>
      b.report_count - a.report_count || b.created_at.localeCompare(a.created_at),
  );

  return (
    <div className="min-h-screen px-4 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-md">
        <PageHeader title="Reports" parent="Admin" parentHref="/admin" />

        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => switchTab(t.key)}
              className={[
                "shrink-0 rounded-full border px-3 py-1.5 text-[length:var(--t-sec)] font-medium transition",
                tab === t.key
                  ? "border-[color:color-mix(in_srgb,var(--sec-accent)_60%,transparent)] bg-[color:color-mix(in_srgb,var(--sec-accent)_18%,transparent)] text-[color:var(--sec-text)]"
                  : "border-[color:var(--hair-panel)] bg-[color:var(--sec-surface)] text-[color:var(--sec-muted)] hover:bg-[color:var(--sec-surface-2)]",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </div>

        {msg ? (
          <div className="mb-3 text-[length:var(--t-sec)] font-normal text-[color:var(--sec-bad)]">
            {msg}
          </div>
        ) : null}

        {loading ? (
          <div className="py-6 text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
            Loading…
          </div>
        ) : sorted.length === 0 ? (
          <div
            className={`${CARD} p-6 text-center text-[length:var(--t-body)] font-normal text-[color:var(--sec-muted)]`}
          >
            Nothing {tab === "open" ? "waiting" : `marked ${tab}`}.
          </div>
        ) : (
          <div className="space-y-[var(--sp-grp)]">
            {sorted.map((r) => {
              const target = r.target;
              const escalated = r.report_count >= ESCALATION_THRESHOLD;

              return (
                <div key={r.id} className={`${CARD} p-3`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Tag on={escalated}>{r.reason_code ?? "report"}</Tag>
                      <Tag>{r.target_type === "comment" ? "Comment" : "Post"}</Tag>
                      {target.exists && target.visibility !== "visible" ? (
                        <Tag>{target.visibility}</Tag>
                      ) : null}
                    </div>

                    {escalated ? (
                      <span className="flex shrink-0 items-center gap-1 text-[length:var(--t-sec)] font-medium text-[color:var(--sec-accent)]">
                        <AlertTriangle size={14} />
                        {r.report_count}
                      </span>
                    ) : null}
                  </div>

                  {target.exists ? (
                    <>
                      <div className="mt-2 text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
                        by {target.author}
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-[length:var(--t-body)] font-normal leading-[1.45] text-[color:var(--sec-text)]">
                        {target.preview}
                      </div>
                      <Link
                        href={target.href}
                        className="mt-2 inline-flex items-center gap-1 text-[length:var(--t-sec)] font-medium text-[color:var(--sec-accent)]"
                      >
                        See in context
                        <ExternalLink size={13} />
                      </Link>
                    </>
                  ) : (
                    <div className="mt-2 text-[length:var(--t-body)] font-normal text-[color:var(--sec-muted)]">
                      The reported content no longer exists.
                    </div>
                  )}

                  <div className="mt-3 border-t border-[color:var(--hair)] pt-2 text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
                    <span className="text-[color:var(--sec-text-2)]">
                      {r.reporter.display_name}
                    </span>{" "}
                    · {new Date(r.created_at).toLocaleString()}
                    {r.reason && r.reason !== r.reason_code ? (
                      <div className="mt-1 whitespace-pre-wrap text-[color:var(--sec-text)]">
                        &ldquo;{r.reason}&rdquo;
                      </div>
                    ) : null}
                  </div>

                  {target.exists ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {target.visibility === "visible" ? (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busyId === r.id}
                            onClick={() => moderate(r, "hide")}
                            className="bg-[color:var(--sec-surface)] text-[color:var(--sec-text)] hover:bg-[color:var(--sec-surface-2)]"
                          >
                            Hide
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busyId === r.id}
                            onClick={() => moderate(r, "remove")}
                            className="bg-[color:var(--sec-surface)] text-[color:var(--sec-bad)] hover:bg-[color:var(--sec-surface-2)]"
                          >
                            Remove
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busyId === r.id}
                          onClick={() => moderate(r, "restore")}
                          className="bg-[color:var(--sec-surface)] text-[color:var(--sec-text)] hover:bg-[color:var(--sec-surface-2)]"
                        >
                          Restore
                        </Button>
                      )}

                      {r.status === "open" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === r.id}
                          onClick={() => setStatus(r, "reviewing")}
                          className="text-[color:var(--sec-muted)] hover:bg-[color:var(--sec-surface-2)]"
                        >
                          Reviewing
                        </Button>
                      ) : null}

                      {r.status === "open" || r.status === "reviewing" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === r.id}
                          onClick={() => setStatus(r, "dismissed")}
                          className="ml-auto text-[color:var(--sec-muted)] hover:bg-[color:var(--sec-surface-2)]"
                        >
                          Dismiss
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
