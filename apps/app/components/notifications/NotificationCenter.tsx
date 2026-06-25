"use client";

import { useMemo, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  AtSign,
  Bell,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  Clock,
  DoorOpen,
  Flag,
  Ticket,
  Trophy,
  Users,
} from "lucide-react";
import {
  renderNotification,
  type NotificationActor,
  type UserNotification,
} from "@/lib/notifications/render";

type Props = {
  open: boolean;
  onClose: () => void;
  items: UserNotification[];
  loading: boolean;
  unreadCount: number;
  markRead: (id: string) => void | Promise<void>;
  markAllRead: () => void | Promise<void>;
  pendingInvitesCount?: number;
  onOpenInvites?: () => void;
};

const ICONS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  "calendar-plus": CalendarPlus,
  "door-open": DoorOpen,
  "at-sign": AtSign,
  flag: Flag,
  "flag-checkered": CheckCircle2,
  trophy: Trophy,
  clock: Clock,
  ticket: Ticket,
  bell: Bell,
};

function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "";
  const diff = Date.now() - d;
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function NotificationCard({
  n,
  onActivate,
}: {
  n: UserNotification;
  onActivate: (n: UserNotification) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rendered = useMemo(() => renderNotification(n.type, n.payload), [n.type, n.payload]);
  const Icon = ICONS[rendered.icon] ?? Bell;

  const actors: NotificationActor[] = Array.isArray(n.payload?.actors) ? n.payload.actors : [];
  const groupable = actors.length > 1;

  return (
    <div
      className={`rounded-2xl border px-3 py-3 transition-colors ${
        n.read
          ? "border-emerald-900/50 bg-emerald-950/30"
          : "border-emerald-500/40 bg-emerald-900/30"
      }`}
    >
      <div className="flex items-start gap-3">
        {!n.read && (
          <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-emerald-400" aria-hidden="true" />
        )}
        <div
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
            n.read ? "bg-emerald-900/50 text-emerald-200/70" : "bg-emerald-400/20 text-emerald-200"
          }`}
        >
          <Icon size={18} />
        </div>

        <button
          type="button"
          onClick={() => onActivate(n)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="truncate text-sm font-extrabold text-emerald-50">{rendered.title}</div>
            <div className="shrink-0 text-[10px] font-semibold text-emerald-200/50">
              {relativeTime(n.updated_at ?? n.created_at)}
            </div>
          </div>
          <div className="mt-0.5 text-xs font-medium text-emerald-100/80">{rendered.body}</div>
        </button>

        {groupable && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 rounded-full p-1 text-emerald-200/60 hover:bg-emerald-900/40 hover:text-emerald-100"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            <ChevronDown
              size={16}
              className={`transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        )}
      </div>

      {groupable && expanded && (
        <div className="mt-2 space-y-1 border-t border-emerald-900/50 pl-12 pt-2">
          {actors.map((a) => (
            <div key={a.profile_id} className="flex items-center gap-2 text-xs text-emerald-100/80">
              <Users size={12} className="text-emerald-300/60" />
              <span className="font-semibold">{a.name}</span>
              {a.course_record && (
                <span className="text-amber-300">
                  🏆 course record{a.course_name ? ` · ${a.course_name}` : ""}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NotificationCenter({
  open,
  onClose,
  items,
  loading,
  unreadCount,
  markRead,
  markAllRead,
  pendingInvitesCount = 0,
  onOpenInvites,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<"all" | "unread">("all");

  const visible = tab === "unread" ? items.filter((i) => !i.read) : items;

  function activate(n: UserNotification) {
    const { url } = renderNotification(n.type, n.payload);
    if (!n.read) void markRead(n.id);
    onClose();
    if (url) router.push(url);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/60" />
          <motion.div
            className="relative flex max-h-[82vh] w-full flex-col rounded-t-3xl border-t border-emerald-900/60 bg-[#071c10] px-4 pb-8 pt-4"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-emerald-800/60" />

            <div className="mb-3 flex items-center justify-between">
              <div className="text-base font-extrabold text-[#f5e6b0]">Notifications</div>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="text-[11px] font-semibold text-emerald-300/80 hover:text-emerald-200"
                >
                  Mark all read
                </button>
              )}
            </div>

            {/* All / Unread toggle */}
            <div className="mb-3 inline-flex gap-1 rounded-full bg-emerald-950/50 p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setTab("all")}
                className={`rounded-full px-3 py-1 ${
                  tab === "all" ? "bg-emerald-400 text-emerald-950" : "text-emerald-200/70"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setTab("unread")}
                className={`rounded-full px-3 py-1 ${
                  tab === "unread" ? "bg-emerald-400 text-emerald-950" : "text-emerald-200/70"
                }`}
              >
                Unread{unreadCount > 0 ? ` (${unreadCount})` : ""}
              </button>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto">
              {pendingInvitesCount > 0 && onOpenInvites && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenInvites();
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-3 py-3 text-left"
                >
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-400/20 text-amber-200">
                    <Users size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-extrabold text-amber-100">
                      {pendingInvitesCount} group invite{pendingInvitesCount === 1 ? "" : "s"}
                    </div>
                    <div className="text-xs font-medium text-amber-100/70">Tap to review</div>
                  </div>
                </button>
              )}

              {loading && visible.length === 0 ? (
                <div className="py-10 text-center text-sm font-semibold text-emerald-100/60">
                  Loading…
                </div>
              ) : visible.length === 0 ? (
                <div className="py-10 text-center text-sm font-semibold text-emerald-100/60">
                  {tab === "unread" ? "No unread notifications" : "No notifications yet"}
                </div>
              ) : (
                visible.map((n) => <NotificationCard key={n.id} n={n} onActivate={activate} />)
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
