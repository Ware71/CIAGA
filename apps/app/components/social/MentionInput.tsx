"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type Mention = { profile_id: string; name: string };

type SearchProfile = { id: string; name: string | null; avatar_url: string | null };

// Active "@token" immediately before the caret (letters/digits/underscore).
const TOKEN_RE = /(?:^|\s)@([\p{L}0-9_]{0,30})$/u;

async function searchProfiles(q: string): Promise<SearchProfile[]> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return [];
  const res = await fetch(`/api/profiles/search?q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.profiles ?? []) as SearchProfile[];
}

/**
 * Textarea with an "@" mention typeahead. Selecting a suggestion inserts
 * "@Name " and records the mention. Mentions whose "@Name" text is deleted are
 * pruned automatically.
 */
export default function MentionInput({
  value,
  onChange,
  mentions,
  onMentionsChange,
  placeholder,
  className,
  dropdownDirection = "down",
}: {
  value: string;
  onChange: (value: string) => void;
  mentions: Mention[];
  onMentionsChange: (mentions: Mention[]) => void;
  placeholder?: string;
  className?: string;
  /** Open the suggestion panel above ("up") or below ("down") the input. */
  dropdownDirection?: "up" | "down";
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [results, setResults] = useState<SearchProfile[]>([]);
  const [open, setOpen] = useState(false);

  function detect(text: string, caret: number) {
    const m = text.slice(0, caret).match(TOKEN_RE);
    setQuery(m ? m[1] : null);
  }

  useEffect(() => {
    if (query == null || query.length < 1) {
      setResults([]);
      setOpen(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await searchProfiles(query);
      if (!cancelled) {
        setResults(r);
        setOpen(r.length > 0);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  // Prune mentions whose text the user removed.
  useEffect(() => {
    const present = mentions.filter((m) => value.includes(`@${m.name}`));
    if (present.length !== mentions.length) onMentionsChange(present);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function applyMention(p: SearchProfile) {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const name = p.name ?? "Player";
    const upToCaret = value.slice(0, caret);
    const after = value.slice(caret);
    const replaced = upToCaret.replace(/@([\p{L}0-9_]{0,30})$/u, `@${name} `);
    onChange(replaced + after);

    if (!mentions.some((m) => m.profile_id === p.id)) {
      onMentionsChange([...mentions, { profile_id: p.id, name }]);
    }
    setOpen(false);
    setQuery(null);

    requestAnimationFrame(() => {
      el?.focus();
      const pos = replaced.length;
      el?.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        placeholder={placeholder}
        className={className}
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyUp={(e) => detect(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
        onClick={(e) => detect(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />

      {open && (
        <div
          className={[
            "absolute left-0 right-0 z-50 max-h-48 overflow-y-auto rounded-xl border border-emerald-900/70 bg-[#071c10] shadow-lg",
            dropdownDirection === "up" ? "bottom-full mb-1" : "mt-1",
          ].join(" ")}
        >
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyMention(r)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-emerald-900/40"
            >
              {r.avatar_url ? (
                <img
                  src={r.avatar_url}
                  alt=""
                  className="h-6 w-6 rounded-full object-cover border border-emerald-900/60"
                />
              ) : (
                <div className="h-6 w-6 rounded-full border border-emerald-900/60 bg-emerald-950/40" />
              )}
              <span className="text-sm font-semibold text-emerald-50">{r.name ?? "Player"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
