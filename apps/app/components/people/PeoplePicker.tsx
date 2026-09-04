"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { fetchFollowingIds, resolveProfileNames } from "@/lib/calendar/api";
import { cn } from "@/lib/utils";

/**
 * Pick several people.
 *
 * The app had no reusable multi-select for this — InvitePlayerSheet is the
 * closest, but it fires an action per row rather than holding a selection, so
 * it can't be borrowed. This is that component: seeded with the people you
 * follow, with a debounced search over the public profile RPC for everyone else.
 *
 * Follows are stored inconsistently — some rows hold a profile id, some an auth
 * user id — so resolution has to try both. That quirk is handled here rather
 * than at each call site.
 */

export type Person = {
  id: string;
  name: string | null;
  avatar_url: string | null;
};

function initials(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "")).toUpperCase();
}

function Avatar({ person, size = 28 }: { person: Person; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-full border border-[color:var(--hair)] bg-[color:var(--sec-surface)] text-[10px] font-medium text-[color:var(--sec-text-2)]"
      style={{ width: size, height: size }}
    >
      {person.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={person.avatar_url} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        initials(person.name)
      )}
    </span>
  );
}

export function PeoplePicker({
  selected,
  onChange,
  excludeIds = [],
  max = 5,
  label = "Add someone",
}: {
  selected: Person[];
  onChange: (next: Person[]) => void;
  /** Usually the viewer — they're already the first row of whatever this feeds. */
  excludeIds?: string[];
  max?: number;
  label?: string;
}) {
  const [query, setQuery] = useState("");
  const [follows, setFollows] = useState<Person[]>([]);
  const [results, setResults] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seq = useRef(0);
  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);
  const selectedIds = useMemo(() => new Set(selected.map((p) => p.id)), [selected]);

  // Seed with the people you follow — for a handicap comparison that is almost
  // always the whole list, so the search is a fallback rather than the path.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) return;
        const { data: rows } = await supabase
          .from("profiles")
          .select("id")
          .eq("owner_user_id", auth.user.id)
          .limit(1);
        const myId = (rows as { id?: string }[] | null)?.[0]?.id;
        if (!myId || cancelled) return;

        const ids = await fetchFollowingIds(myId);
        if (!ids.length || cancelled) return;

        // Follows may hold profile ids or auth user ids; get_profiles_public
        // answers the first, and returns nothing for the second.
        let people = await resolveProfileNames(ids);
        if (people.length === 0) {
          const { data } = await supabase.rpc("get_profiles_public_by_owner_ids", {
            owner_ids: ids,
          });
          people = ((data ?? []) as any[]).map((p) => ({
            id: p.id,
            name: p.name ?? null,
            avatar_url: p.avatar_url ?? null,
          }));
        }
        if (!cancelled) setFollows(people);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Couldn't load your players");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Search the wider directory, debounced.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    const mine = ++seq.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc("search_profiles_public", {
          q,
          lim: 12,
        });
        if (mine !== seq.current) return;
        if (rpcError) throw rpcError;
        setResults(
          ((data ?? []) as any[]).map((p) => ({
            id: p.id,
            name: p.name ?? null,
            avatar_url: p.avatar_url ?? null,
          }))
        );
      } catch {
        if (mine === seq.current) setResults([]);
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q.length >= 2 ? [...results, ...follows] : follows;
    const seen = new Set<string>();
    return pool.filter((p) => {
      if (excluded.has(p.id) || selectedIds.has(p.id) || seen.has(p.id)) return false;
      if (q.length >= 2 && !(p.name ?? "").toLowerCase().includes(q)) {
        // Keep RPC hits even if the name match isn't literal — it may have
        // matched on something we don't display.
        if (!results.some((r) => r.id === p.id)) return false;
      }
      seen.add(p.id);
      return true;
    });
  }, [query, results, follows, excluded, selectedIds]);

  const add = useCallback(
    (p: Person) => {
      if (selected.length >= max) return;
      onChange([...selected, p]);
      setQuery("");
    },
    [selected, onChange, max]
  );

  const remove = useCallback(
    (id: string) => onChange(selected.filter((p) => p.id !== id)),
    [selected, onChange]
  );

  const full = selected.length >= max;

  return (
    <div>
      {selected.length > 0 ? (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {selected.map((p) => (
            <span
              key={p.id}
              className="flex items-center gap-1.5 rounded-full border border-[color:var(--sec-hair)] bg-[color:var(--sec-surface)] py-1 pl-1 pr-2"
            >
              <Avatar person={p} size={20} />
              <span className="text-[length:var(--t-sec)] text-[color:var(--sec-text)]">
                {p.name ?? "Player"}
              </span>
              <button
                type="button"
                onClick={() => remove(p.id)}
                aria-label={`Remove ${p.name ?? "player"}`}
                className="text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text)]"
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {!full ? (
        <div className="relative">
          <Search
            size={15}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--sec-muted)]"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={label}
            aria-label={label}
            className="h-10 w-full rounded-[var(--r-ui)] border border-[color:var(--sec-hair)] bg-[color:var(--sec-surface)] pl-9 pr-9 text-[length:var(--t-body)] text-[color:var(--sec-text)] placeholder:text-[color:var(--sec-muted)] focus:border-[color:var(--sec-accent)] focus:outline-none"
          />
          {searching || loading ? (
            <Loader2
              size={15}
              className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[color:var(--sec-muted)]"
            />
          ) : null}
        </div>
      ) : (
        <p className="text-[length:var(--t-sec)] text-[color:var(--sec-muted)]">
          That's {max} — remove someone to add another.
        </p>
      )}

      {error ? (
        <p className="mt-2 text-[length:var(--t-sec)] text-[color:var(--sec-bad)]">{error}</p>
      ) : null}

      {!full && options.length > 0 ? (
        <div className="mt-2 max-h-[210px] overflow-y-auto">
          {options.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => add(p)}
              className={cn(
                "flex w-full items-center gap-2.5 border-b border-[color:var(--hair)] py-2 text-left last:border-b-0",
                "transition-colors hover:bg-[color:var(--sec-surface)]"
              )}
            >
              <Avatar person={p} />
              <span className="truncate text-[length:var(--t-body)] text-[color:var(--sec-text)]">
                {p.name ?? "Player"}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {!full && !loading && options.length === 0 && query.trim().length >= 2 && !searching ? (
        <p className="mt-2 text-[length:var(--t-sec)] text-[color:var(--sec-muted)]">
          Nobody by that name.
        </p>
      ) : null}
    </div>
  );
}

export default PeoplePicker;
