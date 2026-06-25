"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { BackButton } from "@/components/ui/BackButton";

type Announcement = {
  id: string;
  slug: string | null;
  kind: string;
  title: string;
  body: string | null;
  image_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  active: boolean;
  priority: number;
  publish_at: string | null;
  expires_at: string | null;
  created_at: string;
};

const EMPTY = {
  kind: "promo",
  title: "",
  body: "",
  image_url: "",
  cta_label: "",
  cta_url: "",
  priority: 0,
  active: true,
};

async function authToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export default function AdminAnnouncementsPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [adminOk, setAdminOk] = useState(false);
  const [items, setItems] = useState<Announcement[]>([]);
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const token = await authToken();
    if (!token) return;
    const res = await fetch("/api/admin/announcements", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (res.ok) setItems(json.announcements ?? []);
    else setMsg(json.error || "Failed to load");
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
      setAdminOk(true);
      setChecking(false);
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [router, refresh]);

  async function create() {
    setMsg(null);
    if (!form.title.trim()) {
      setMsg("Title is required");
      return;
    }
    setSaving(true);
    try {
      const token = await authToken();
      const res = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg(json.error || "Failed to create");
        return;
      }
      setForm({ ...EMPTY });
      setMsg("Announcement created.");
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(a: Announcement) {
    const token = await authToken();
    await fetch(`/api/admin/announcements/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ active: !a.active }),
    });
    await refresh();
  }

  async function remove(a: Announcement) {
    const token = await authToken();
    await fetch(`/api/admin/announcements/${a.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    await refresh();
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-[#042713] px-4 pt-8 text-slate-100">
        <div className="mx-auto w-full max-w-sm rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
          Checking admin access…
        </div>
      </div>
    );
  }
  if (!adminOk) return null;

  const input =
    "w-full rounded-xl bg-black/30 border border-emerald-900/60 px-3 py-2 text-base outline-none";

  return (
    <div className="min-h-screen bg-[#042713] px-4 pt-8 text-slate-100">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <header className="flex items-center justify-between">
          <BackButton onClick={() => router.back()} />
          <div className="flex-1 text-center">
            <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Announcements</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
              Push info & promos to users
            </div>
          </div>
          <div className="w-[60px]" />
        </header>

        {msg && (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/90">
            {msg}
          </div>
        )}

        {/* CREATE */}
        <div className="space-y-3 rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
          <div className="text-sm font-semibold text-[#f5e6b0]">New announcement</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              className={input}
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
            >
              <option value="promo">Promo</option>
              <option value="info">Info</option>
            </select>
            <input
              className={input}
              type="number"
              placeholder="Priority (higher first)"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value || "0", 10) })}
            />
          </div>
          <input
            className={input}
            placeholder="Title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <textarea
            className={`${input} min-h-[90px]`}
            placeholder="Body"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
          <input
            className={input}
            placeholder="Image URL (optional)"
            value={form.image_url}
            onChange={(e) => setForm({ ...form, image_url: e.target.value })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className={input}
              placeholder="CTA label (optional)"
              value={form.cta_label}
              onChange={(e) => setForm({ ...form, cta_label: e.target.value })}
            />
            <input
              className={input}
              placeholder="CTA URL or in-app path (optional)"
              value={form.cta_url}
              onChange={(e) => setForm({ ...form, cta_url: e.target.value })}
            />
          </div>
          <button
            type="button"
            onClick={create}
            disabled={saving}
            className="rounded-xl bg-emerald-700/80 px-4 py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Create announcement"}
          </button>
        </div>

        {/* LIST */}
        <div className="space-y-3 rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
          <div className="text-sm text-emerald-100/80">{items.length} announcement(s)</div>
          {items.map((a) => (
            <div key={a.id} className="rounded-xl border border-emerald-900/60 bg-black/20 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-emerald-50">
                    {a.title}{" "}
                    <span className="text-[11px] uppercase text-emerald-200/50">· {a.kind}</span>
                    {a.slug ? (
                      <span className="text-[11px] text-emerald-200/40"> · {a.slug}</span>
                    ) : null}
                  </div>
                  {a.body ? (
                    <div className="mt-1 line-clamp-2 text-xs text-emerald-100/60">{a.body}</div>
                  ) : null}
                  <div className="mt-1 text-[11px] text-emerald-200/40">priority {a.priority}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <button
                    type="button"
                    onClick={() => toggleActive(a)}
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                      a.active
                        ? "bg-emerald-400 text-emerald-950"
                        : "border border-emerald-900/60 text-emerald-200/60"
                    }`}
                  >
                    {a.active ? "Active" : "Inactive"}
                  </button>
                  {a.kind !== "onboarding" && (
                    <button
                      type="button"
                      onClick={() => remove(a)}
                      className="text-[11px] font-semibold text-red-300/80 hover:text-red-200"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
