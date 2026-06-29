"use client";

import type { FeedItemVM } from "@/lib/feed/types";
import { isLiveItem, miniFeedCopy } from "@/lib/feed/feedItemUtils";

// --- Avatar helpers ---

export type AvatarLike = { url: string | null; initials: string; key: string };

function initialsFromName(name: string): string {
  const s = String(name ?? "").trim();
  if (!s) return "C";
  const parts = s.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "C";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase();
}

function avatarLikeFromAny(x: any, fallbackKey: string): AvatarLike | null {
  if (!x) return null;
  const url = (typeof x.avatar_url === "string" && x.avatar_url.trim() ? x.avatar_url : null) as string | null;
  const name =
    (typeof x.display_name === "string" && x.display_name.trim() ? x.display_name : null) ??
    (typeof x.name === "string" && x.name.trim() ? x.name : null) ??
    null;
  const initials = initialsFromName(name ?? "CIAGA");
  const key = String(x.id ?? x.profile_id ?? x.user_id ?? fallbackKey);
  return { url, initials, key };
}

function avatarStack(item: FeedItemVM): AvatarLike[] {
  const p: any = item.payload ?? {};
  const cands: AvatarLike[] = [];

  const a = avatarLikeFromAny((item as any).actor, "actor");
  if (a) cands.push(a);

  const s = avatarLikeFromAny((item as any).subject, "subject");
  if (s) cands.push(s);

  const participants = Array.isArray(p?.participants) ? p.participants : Array.isArray(p?.players) ? p.players : [];
  if (Array.isArray(participants)) {
    for (let i = 0; i < participants.length; i++) {
      const v = avatarLikeFromAny(participants[i], `p${i}`);
      if (v) cands.push(v);
      if (cands.length >= 6) break;
    }
  }

  const seen = new Set<string>();
  const out: AvatarLike[] = [];
  for (const c of cands) {
    const k = `${c.key}|${c.url ?? ""}|${c.initials}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length >= 3) break;
  }

  if (!out.length) out.push({ url: null, initials: "C", key: "ciaga" });
  return out;
}

// --- Components ---

export function AvatarStack({ item }: { item: FeedItemVM }) {
  const avs = avatarStack(item);

  return (
    <div className="flex -space-x-2">
      {avs.map((a, idx) => (
        <div
          key={`${a.key}-${idx}`}
          className={[
            "h-7 w-7 rounded-full border border-emerald-900/45 bg-emerald-900/15 overflow-hidden",
            "grid place-items-center text-[10px] font-extrabold text-emerald-50/90",
          ].join(" ")}
          style={{ zIndex: 10 - idx }}
        >
          {a.url ? (
            <img
              src={a.url}
              alt=""
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
              draggable={false}
            />
          ) : (
            a.initials
          )}
        </div>
      ))}
    </div>
  );
}

function relTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const mins = Math.floor(Math.max(0, Date.now() - t) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

/** Short secondary line: who + a key stat + age. */
function miniFeedDetail(item: FeedItemVM): string | null {
  const p: any = item.payload ?? {};
  const name =
    (item as any).subject?.display_name ??
    (item as any).actor?.display_name ??
    (typeof p.name === "string" ? p.name : null) ??
    (Array.isArray(p.players) && p.players[0]?.name) ??
    null;

  let stat: string | null = null;
  if (item.type === "pb" || item.type === "course_record") {
    if (typeof p.gross_total === "number") stat = `Gross ${p.gross_total}`;
  } else if (item.type === "hole_event") {
    if (typeof p.hole_number === "number") stat = `Hole ${p.hole_number}`;
  } else if (item.type === "round_played") {
    const n = Array.isArray(p.players) ? p.players.length : 0;
    if (n > 1) stat = `${n} players`;
  }

  const age = relTime(item.occurred_at ?? item.created_at);
  return [name, stat, age].filter(Boolean).join(" · ") || null;
}

export function MiniFeedTeaserCard({ item, onOpen }: { item: FeedItemVM; onOpen: () => void }) {
  const live = isLiveItem(item);
  const detail = miniFeedDetail(item);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={[
        "group w-full text-left rounded-2xl border",
        live ? "border-emerald-300/35 bg-emerald-900/10" : "border-emerald-900/35 bg-emerald-950/10",
        "px-2.5 py-2 hover:bg-emerald-900/25 active:scale-[0.99] transition",
        "flex items-center gap-2.5",
      ].join(" ")}
      aria-label="Open in social feed"
      title="Open in social feed"
    >
      <div className="shrink-0">
        <AvatarStack item={item} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 text-[11px] font-extrabold text-emerald-50/95 leading-snug truncate">
            {miniFeedCopy(item)}
          </div>

          {live ? (
            <span className="shrink-0 text-[9px] font-extrabold tracking-wide px-2 py-0.5 rounded-full bg-emerald-400/15 text-emerald-100 border border-emerald-300/25">
              LIVE
            </span>
          ) : null}
        </div>

        {detail ? (
          <div className="mt-0.5 text-[10px] font-semibold text-emerald-100/55 truncate">{detail}</div>
        ) : null}
      </div>

      <div className="shrink-0 text-emerald-100/40 group-hover:text-emerald-100/70 transition text-base leading-none">
        ›
      </div>
    </button>
  );
}
