"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MapPin, Search, Star, X } from "lucide-react";
import MapLocationPicker from "@/components/map-location-picker";
import { Row } from "@/components/ui/chrome";
import { Skeleton } from "@/components/ui/skeleton";
import { COURSE_PAGE_SIZE } from "@/lib/courses/constants";
import { formatDistance } from "@/lib/courses/rank";
import { resolveCourseId } from "@/lib/courses/resolveCourse";
import { useCourseBrowser, type CourseBrowserTab } from "@/lib/courses/useCourseBrowser";
import type { CourseHit } from "@/lib/courses/types";
import { cn } from "@/lib/utils";

/**
 * One course list, used everywhere a course is chosen or browsed.
 *
 * /courses and the round-setup picker used to be two ~70% identical copies with
 * different radii and different empty states — the same feature giving two
 * answers depending which door you came through. This is that feature, once.
 *
 * Typing takes the screen over: the tabs step aside and the result is a single
 * flat ranked list blending all four sources, because "which tab is Formby
 * under" is a question the user should never have to answer. The local sources
 * are already in memory, so those hits appear on the keystroke; the worldwide
 * half is debounced and merges in underneath.
 */

const TABS: { key: CourseBrowserTab; label: string }[] = [
  { key: "nearby", label: "Nearby" },
  { key: "favourites", label: "Favourites" },
  { key: "played", label: "My courses" },
];

export function CourseBrowser({
  mode,
  onSelect,
  className,
}: {
  /** `select` returns a course id to the caller; `navigate` opens the course. */
  mode: "select" | "navigate";
  onSelect: (courseId: string, courseName: string) => void;
  className?: string;
}) {
  const browser = useCourseBrowser();
  const [tab, setTab] = useState<CourseBrowserTab>("nearby");
  const [pinOpen, setPinOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [visible, setVisible] = useState(COURSE_PAGE_SIZE);

  const { searching, searchHits, tabHits } = browser;
  const hits = searching ? searchHits : tabHits[tab];

  // A new query or tab is a new list; showing page 4 of it would be wrong.
  useEffect(() => setVisible(COURSE_PAGE_SIZE), [browser.query, tab]);

  const shown = useMemo(() => hits.slice(0, visible), [hits, visible]);
  const hasMore = visible < hits.length;

  /**
   * Reveal-on-scroll, replacing the old "show all within 5 km / search wider
   * area" stepper. Overpass hands back the whole radius in one response, so
   * paging is a slice rather than a fetch — the sentinel just uncovers more.
   * Same IntersectionObserver shape as the social feed.
   */
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible((v) => v + COURSE_PAGE_SIZE);
        }
      },
      { rootMargin: "400px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore]);

  const choose = useCallback(
    async (hit: CourseHit) => {
      const key = hit.osmId ?? hit.courseId ?? hit.name;
      setBusyKey(key);
      try {
        const id = await resolveCourseId(hit);
        onSelect(id, hit.name);
      } catch (e: any) {
        browser.setError(e?.message ?? "Couldn't open that course");
      } finally {
        setBusyKey(null);
      }
    },
    [onSelect, browser]
  );

  const star = useCallback(
    async (hit: CourseHit) => {
      const key = hit.osmId ?? hit.courseId ?? hit.name;
      setBusyKey(key);
      try {
        // A course has to exist before it can be starred — a worldwide result
        // is an OSM id and nothing else until it's resolved.
        const id = await resolveCourseId(hit);
        await browser.toggleFavourite(hit, id);
      } catch (e: any) {
        browser.setError(e?.message ?? "Couldn't save that");
      } finally {
        setBusyKey(null);
      }
    },
    [browser]
  );

  const listLoading = searching
    ? browser.globalLoading && hits.length === 0
    : tab === "nearby"
      ? browser.nearbyLoading
      : browser.localLoading;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      {/* Search + pin */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--sec-muted)]"
          />
          <input
            value={browser.query}
            onChange={(e) => browser.setQuery(e.target.value)}
            placeholder="Search any course"
            aria-label="Search courses"
            className="h-10 w-full rounded-[var(--r-ui)] border border-[color:var(--sec-hair)] bg-[color:var(--sec-surface)] pl-9 pr-9 text-[length:var(--t-body)] text-[color:var(--sec-text)] placeholder:text-[color:var(--sec-muted)] focus:border-[color:var(--sec-accent)] focus:outline-none"
          />
          {browser.query ? (
            <button
              type="button"
              onClick={() => browser.setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text)]"
            >
              <X size={15} />
            </button>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setPinOpen(true)}
          aria-label="Drop a pin on the map"
          title="Drop a pin"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--r-ui)] border border-[color:var(--sec-hair)] text-[color:var(--sec-muted)] transition-colors hover:bg-[color:var(--sec-surface)] hover:text-[color:var(--sec-text)]"
        >
          <MapPin size={17} />
        </button>
      </div>

      {/* Tabs — a search spans all of them, so they stand down while typing. */}
      {!searching ? (
        <div className="mt-3 flex gap-1.5" role="tablist">
          {TABS.map((t) => {
            const on = t.key === tab;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.key)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-[length:var(--t-sec)] font-medium transition-colors",
                  on
                    ? "bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)]"
                    : "border border-[color:var(--sec-hair)] text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text)]"
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 text-[length:var(--t-label)] uppercase tracking-[0.1em] text-[color:var(--sec-muted)]">
          {browser.globalLoading ? "Searching everywhere…" : `${hits.length} result${hits.length === 1 ? "" : "s"}`}
        </p>
      )}

      {browser.error ? (
        <p className="mt-3 text-[length:var(--t-sec)] text-[color:var(--sec-bad)]">{browser.error}</p>
      ) : null}

      {!searching && tab === "nearby" && browser.positionError ? (
        <p className="mt-3 text-[length:var(--t-sec)] text-[color:var(--sec-muted)]">
          {browser.positionError}
        </p>
      ) : null}

      {/* The list */}
      <div className="mt-1 min-h-0 flex-1 overflow-y-auto">
        {listLoading ? (
          <div className="space-y-2 py-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full rounded-[var(--r-ui)]" />
            ))}
          </div>
        ) : hits.length === 0 ? (
          <p className="py-6 text-center text-[length:var(--t-body)] text-[color:var(--sec-muted)]">
            {searching
              ? "Nothing matched. Try fewer words."
              : tab === "favourites"
                ? "No favourites yet. Tap the star on any course."
                : tab === "played"
                  ? "No finished rounds yet."
                  : "No courses found near you."}
          </p>
        ) : (
          <>
            {shown.map((hit) => {
              const key = hit.osmId ?? hit.courseId ?? hit.name;
              const busy = busyKey === key;
              return (
                <CourseRow
                  key={key}
                  hit={hit}
                  busy={busy}
                  actionLabel={mode === "select" ? "Select" : "View"}
                  onChoose={() => void choose(hit)}
                  onStar={() => void star(hit)}
                />
              );
            })}
            <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
            {hasMore ? (
              <button
                type="button"
                onClick={() => setVisible((v) => v + COURSE_PAGE_SIZE)}
                className="w-full py-3 text-[length:var(--t-sec)] text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text)]"
              >
                Load more
              </button>
            ) : null}
          </>
        )}
      </div>

      {pinOpen ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4">
          <MapLocationPicker
            initial={browser.position ?? undefined}
            fallbackCenter={browser.position ?? undefined}
            onConfirm={(pos) => {
              browser.searchAt({
                lat: Math.max(-90, Math.min(90, pos.lat)),
                lng: Math.max(-180, Math.min(180, pos.lng)),
              });
              setTab("nearby");
              browser.setQuery("");
              setPinOpen(false);
            }}
            onClear={() => setPinOpen(false)}
            onClose={() => setPinOpen(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * One result. The meta line carries the provenance that section headings would
 * otherwise have had to — a star, a round count, a distance, a place.
 *
 * The row has two independent actions, so it can't be one big button with the
 * star inside it: a nested button is invalid HTML and React refuses to hydrate
 * it. Instead `Row` renders as a plain div and the choose action is a
 * full-bleed overlay button sitting *under* the star, which keeps the whole row
 * tappable and both actions reachable from the keyboard.
 */
function CourseRow({
  hit,
  busy,
  actionLabel,
  onChoose,
  onStar,
}: {
  hit: CourseHit;
  busy: boolean;
  actionLabel: string;
  onChoose: () => void;
  onStar: () => void;
}) {
  const meta = [
    typeof hit.roundsPlayed === "number" && hit.roundsPlayed > 0
      ? `${hit.roundsPlayed} round${hit.roundsPlayed === 1 ? "" : "s"}`
      : null,
    formatDistance(hit.distanceM) || null,
    [hit.city, hit.country].filter(Boolean).join(", ") || null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="relative">
      <Row
        title={hit.name}
        subtitle={meta || undefined}
        className="transition-colors hover:bg-[color:var(--sec-surface)]"
        trailing={
          <span className="relative z-10 flex items-center gap-1">
            <button
              type="button"
              aria-label={hit.isFavourite ? `Unstar ${hit.name}` : `Star ${hit.name}`}
              aria-pressed={hit.isFavourite}
              disabled={busy}
              onClick={onStar}
              className="grid h-9 w-9 place-items-center rounded-full text-[color:var(--sec-muted)] transition-colors hover:text-[color:var(--sec-accent)] disabled:opacity-50"
            >
              <Star
                size={16}
                strokeWidth={2}
                className={hit.isFavourite ? "text-[color:var(--sec-accent)]" : undefined}
                fill={hit.isFavourite ? "currentColor" : "none"}
              />
            </button>
            {busy ? (
              <Loader2 size={15} className="animate-spin text-[color:var(--sec-muted)]" />
            ) : null}
          </span>
        }
      />
      <button
        type="button"
        disabled={busy}
        onClick={onChoose}
        aria-label={`${actionLabel} ${hit.name}`}
        className="absolute inset-0 z-0 rounded-[6px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--sec-accent)]"
      />
    </div>
  );
}

export default CourseBrowser;
