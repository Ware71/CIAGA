"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type {
  CompetitionSeriesWithEvents,
  SeriesEventTemplate,
  SeriesYearGroup,
} from "@/lib/majors/types";

const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ─── Add / Edit Event Template modal ─────────────────────────────────────────

function EventTemplateModal({
  seriesId,
  existing,
  onClose,
  onSaved,
}: {
  seriesId: string;
  existing: SeriesEventTemplate | null;
  onClose: () => void;
  onSaved: (et: SeriesEventTemplate) => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [month, setMonth] = useState(existing?.typical_month?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const session = await getViewerSession();
      if (!session) { setError("Not signed in"); return; }
      const headers = { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" };
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        typical_month: month ? parseInt(month, 10) : null,
      };

      let res: Response;
      if (existing) {
        res = await fetch(`/api/majors/series/${seriesId}/events/${existing.id}`, {
          method: "PATCH", headers, body: JSON.stringify(body),
        });
      } else {
        res = await fetch(`/api/majors/series/${seriesId}/events`, {
          method: "POST", headers, body: JSON.stringify(body),
        });
      }
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Save failed"); return; }
      onSaved(json.event_template);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl bg-[#0a2e18] border border-emerald-800/60 p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-semibold text-emerald-50">
          {existing ? "Edit Event" : "Add Event"}
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Event Name *</label>
            <input
              className="w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-200/30 focus:outline-none"
              placeholder="e.g. The Masters"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Description</label>
            <input
              className="w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-200/30 focus:outline-none"
              placeholder="Optional"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Typical Month</label>
            <select
              className="w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-3 py-2 text-sm text-emerald-50 focus:outline-none"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              <option value="">No preference</option>
              {monthNames.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
        </div>
        {error && <div className="text-xs text-red-400">{error}</div>}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 rounded-full border border-emerald-700/50 text-sm text-emerald-200 hover:bg-emerald-900/30"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="flex-1 py-2 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Create Season modal ──────────────────────────────────────────────────────

function CreateSeasonModal({
  seriesId,
  eventTemplates,
  onClose,
  onCreated,
}: {
  seriesId: string;
  eventTemplates: SeriesEventTemplate[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    const y = parseInt(year, 10);
    if (!y) return;
    setCreating(true);
    setError(null);
    try {
      const session = await getViewerSession();
      if (!session) { setError("Not signed in"); return; }
      const res = await fetch(`/api/majors/series/${seriesId}/instantiate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ year: y }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to create season"); return; }
      onCreated();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl bg-[#0a2e18] border border-emerald-800/60 p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-semibold text-emerald-50">Create Season</div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Year</label>
          <input
            type="number"
            className="w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-3 py-2 text-sm text-emerald-50 focus:outline-none"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-emerald-200/60 mb-1">Events to create</div>
          <div className="space-y-1">
            {eventTemplates.map((et) => (
              <div key={et.id} className="flex items-center gap-2 text-sm text-emerald-100/80">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span>{et.name}</span>
                {et.typical_month && (
                  <span className="text-[10px] text-emerald-200/40">
                    ({monthNames[et.typical_month - 1]})
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
        {error && <div className="text-xs text-red-400">{error}</div>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose}
            className="flex-1 py-2 rounded-full border border-emerald-700/50 text-sm text-emerald-200 hover:bg-emerald-900/30">
            Cancel
          </button>
          <button type="button" onClick={handleCreate}
            disabled={creating || !year}
            className="flex-1 py-2 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-40">
            {creating ? "Creating…" : `Create ${year} Season`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SeriesDetailClient({ seriesId }: { seriesId: string }) {
  const router = useRouter();
  const [series, setSeries] = useState<CompetitionSeriesWithEvents | null>(null);
  const [history, setHistory] = useState<SeriesYearGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [editingEvent, setEditingEvent] = useState<SeriesEventTemplate | null>(null);
  const [showCreateSeason, setShowCreateSeason] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);

  const isAdminOrOwner = myRole === "owner" || myRole === "admin";

  const load = async () => {
    setLoading(true);
    try {
      const session = await getViewerSession();
      if (!session) { router.push("/login"); return; }
      const headers = { Authorization: `Bearer ${session.accessToken}` };

      const [seriesRes, historyRes] = await Promise.all([
        fetch(`/api/majors/series/${seriesId}`, { headers }),
        fetch(`/api/majors/series/${seriesId}/history`, { headers }),
      ]);

      if (seriesRes.ok) {
        const j = await seriesRes.json();
        const s = j.series as CompetitionSeriesWithEvents;
        // Sort event_templates by sort_order
        s.event_templates = (s.event_templates ?? []).sort((a, b) => a.sort_order - b.sort_order);
        setSeries(s);

        // Determine caller's role in the group via members list
        if (s.group_id) {
          const memberRes = await fetch(`/api/majors/groups/${s.group_id}/members`, { headers });
          if (memberRes.ok) {
            const gj = await memberRes.json();
            const members: any[] = gj.members ?? [];
            const own = members.find((m) => m.profile_id === session.profileId);
            setMyRole(own?.role ?? null);
          }
        }
      }

      if (historyRes.ok) {
        const hj = await historyRes.json();
        setHistory(hj.history ?? []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [seriesId]);

  const handleEventSaved = (et: SeriesEventTemplate) => {
    setSeries((prev) => {
      if (!prev) return prev;
      const exists = prev.event_templates.find((e) => e.id === et.id);
      const updated = exists
        ? prev.event_templates.map((e) => (e.id === et.id ? et : e))
        : [...prev.event_templates, et];
      return { ...prev, event_templates: updated.sort((a, b) => a.sort_order - b.sort_order) };
    });
    setShowAddEvent(false);
    setEditingEvent(null);
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!confirm("Remove this event template? Past competitions will not be affected.")) return;
    setDeletingEventId(eventId);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/series/${seriesId}/events/${eventId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (res.ok) {
        setSeries((prev) =>
          prev ? { ...prev, event_templates: prev.event_templates.filter((e) => e.id !== eventId) } : prev
        );
      }
    } finally {
      setDeletingEventId(null);
    }
  };

  const handleMoveEvent = async (eventId: string, direction: "up" | "down") => {
    if (!series) return;
    const idx = series.event_templates.findIndex((e) => e.id === eventId);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= series.event_templates.length) return;

    const updated = [...series.event_templates];
    const newOrder = updated[swapIdx].sort_order;
    const currOrder = updated[idx].sort_order;

    // Swap sort_order values
    updated[idx] = { ...updated[idx], sort_order: newOrder };
    updated[swapIdx] = { ...updated[swapIdx], sort_order: currOrder };
    updated.sort((a, b) => a.sort_order - b.sort_order);

    setSeries({ ...series, event_templates: updated });

    // Persist both
    const session = await getViewerSession();
    if (!session) return;
    const headers = { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" };
    await Promise.all([
      fetch(`/api/majors/series/${seriesId}/events/${updated[swapIdx].id}`, {
        method: "PATCH", headers, body: JSON.stringify({ sort_order: currOrder }),
      }),
      fetch(`/api/majors/series/${seriesId}/events/${updated[idx].id}`, {
        method: "PATCH", headers, body: JSON.stringify({ sort_order: newOrder }),
      }),
    ]);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#071c0f] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-emerald-500/40 border-t-emerald-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (!series) {
    return (
      <div className="min-h-screen bg-[#071c0f] flex items-center justify-center text-emerald-200/50 text-sm">
        Series not found.
      </div>
    );
  }

  const eventTemplates = series.event_templates ?? [];

  return (
    <div className="min-h-screen bg-[#071c0f] text-emerald-50">
      {/* Header */}
      <div className="px-4 pt-10 pb-6 max-w-lg mx-auto">
        {series.group_id && (
          <button
            type="button"
            onClick={() => router.push(`/majors/groups/${series.group_id}`)}
            className="text-[11px] text-emerald-300/60 hover:text-emerald-300 mb-3 flex items-center gap-1"
          >
            ← Group
          </button>
        )}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-emerald-50">{series.name}</h1>
            {series.description && (
              <p className="text-sm text-emerald-100/55 mt-1">{series.description}</p>
            )}
          </div>
          {series.recur_annually && (
            <span className="shrink-0 text-[9px] font-semibold px-2 py-0.5 rounded-full border border-emerald-700/50 bg-emerald-900/30 text-emerald-300">
              Annual
            </span>
          )}
        </div>
      </div>

      <div className="px-4 pb-24 max-w-lg mx-auto space-y-6">

        {/* ── Event Templates ─────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/60 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-emerald-200/70 uppercase tracking-wider">
              Events in this Series
            </div>
            {isAdminOrOwner && (
              <button
                type="button"
                onClick={() => setShowAddEvent(true)}
                className="text-[11px] font-semibold text-emerald-300 hover:text-emerald-100"
              >
                + Add
              </button>
            )}
          </div>

          {eventTemplates.length === 0 ? (
            <div className="text-sm text-emerald-100/40 py-4 text-center">
              {isAdminOrOwner
                ? "No events yet. Add the events that make up this series."
                : "No events defined for this series yet."}
            </div>
          ) : (
            <div className="space-y-2">
              {eventTemplates.map((et, idx) => (
                <div
                  key={et.id}
                  className="flex items-center gap-3 rounded-xl border border-emerald-900/50 bg-emerald-950/40 px-3 py-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-emerald-50">{et.name}</div>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {et.typical_month != null && (
                        <span className="text-[10px] text-emerald-200/45 border border-emerald-900/40 rounded-full px-1.5 py-0.5">
                          {monthNames[et.typical_month - 1]}
                        </span>
                      )}
                      {et.template_competition_type && (
                        <span className="text-[10px] text-emerald-200/45 border border-emerald-900/40 rounded-full px-1.5 py-0.5 capitalize">
                          {et.template_competition_type}
                        </span>
                      )}
                      {et.template_scoring_model && (
                        <span className="text-[10px] text-emerald-200/45 border border-emerald-900/40 rounded-full px-1.5 py-0.5 capitalize">
                          {et.template_scoring_model}
                        </span>
                      )}
                    </div>
                  </div>
                  {isAdminOrOwner && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleMoveEvent(et.id, "up")}
                        disabled={idx === 0}
                        className="w-6 h-6 flex items-center justify-center rounded text-emerald-300/50 hover:text-emerald-200 disabled:opacity-20"
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveEvent(et.id, "down")}
                        disabled={idx === eventTemplates.length - 1}
                        className="w-6 h-6 flex items-center justify-center rounded text-emerald-300/50 hover:text-emerald-200 disabled:opacity-20"
                        title="Move down"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingEvent(et)}
                        className="w-6 h-6 flex items-center justify-center rounded text-emerald-300/50 hover:text-emerald-200"
                        title="Edit"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteEvent(et.id)}
                        disabled={deletingEventId === et.id}
                        className="w-6 h-6 flex items-center justify-center rounded text-rose-400/50 hover:text-rose-300 disabled:opacity-40"
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Create season CTA */}
          {isAdminOrOwner && eventTemplates.length > 0 && (
            <button
              type="button"
              onClick={() => setShowCreateSeason(true)}
              className="w-full py-2.5 rounded-full bg-emerald-700/90 text-sm font-semibold text-white hover:bg-emerald-600 mt-1"
            >
              + Create {new Date().getFullYear()} Season
            </button>
          )}
        </section>

        {/* ── Past Seasons ─────────────────────────────────────────────────── */}
        <section className="space-y-4">
          <div className="text-xs font-semibold text-emerald-200/70 uppercase tracking-wider px-1">
            Past Seasons
          </div>

          {history.length === 0 ? (
            <div className="rounded-2xl border border-emerald-900/40 bg-[#0b3b21]/40 p-6 text-sm text-emerald-100/40 text-center">
              No seasons yet.
            </div>
          ) : (
            history.map((yearGroup) => (
              <div key={yearGroup.year} className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/60 p-4 space-y-3">
                <div className="text-sm font-bold text-emerald-200">{yearGroup.year}</div>
                <div className="space-y-2">
                  {yearGroup.competitions.map(({ competition, event_template, winner }) => (
                    <button
                      key={competition.id}
                      type="button"
                      onClick={() => router.push(`/majors/competitions/${competition.id}`)}
                      className="w-full text-left rounded-xl border border-emerald-900/40 bg-emerald-950/30 px-3 py-2.5 hover:bg-emerald-900/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-emerald-50 truncate">
                            {event_template?.name ?? competition.name}
                          </div>
                          {competition.competition_date && (
                            <div className="text-[11px] text-emerald-200/45 mt-0.5">
                              {new Date(competition.competition_date).toLocaleDateString("en-GB", {
                                day: "numeric", month: "short",
                              })}
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <StatusPill status={competition.majors_status} />
                          {winner && competition.majors_status === "completed" && (
                            <div className="text-[11px] text-emerald-200/55 mt-1">
                              {winner.name ?? "—"}
                              {winner.net_score != null && (
                                <span className="text-emerald-300/60"> · {winner.net_score}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </section>
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────────── */}
      {(showAddEvent || editingEvent) && (
        <EventTemplateModal
          seriesId={seriesId}
          existing={editingEvent}
          onClose={() => { setShowAddEvent(false); setEditingEvent(null); }}
          onSaved={handleEventSaved}
        />
      )}

      {showCreateSeason && (
        <CreateSeasonModal
          seriesId={seriesId}
          eventTemplates={eventTemplates}
          onClose={() => setShowCreateSeason(false)}
          onCreated={() => {
            setShowCreateSeason(false);
            load(); // reload to show new season
          }}
        />
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    upcoming: "bg-sky-900/40 text-sky-300 border-sky-700/40",
    live: "bg-emerald-800/50 text-emerald-300 border-emerald-600/50",
    completed: "bg-emerald-900/30 text-emerald-400/70 border-emerald-800/40",
    cancelled: "bg-rose-900/30 text-rose-400 border-rose-700/30",
  };
  return (
    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border capitalize ${map[status] ?? ""}`}>
      {status}
    </span>
  );
}
