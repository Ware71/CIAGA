"use client";

import { X } from "lucide-react";
import { CourseBrowser } from "@/components/courses/CourseBrowser";

/**
 * The course picker sheet.
 *
 * All 500 lines of list, search, radius stepper and map that used to live here
 * are now CourseBrowser, shared with /courses. What remains is the sheet: a
 * full-screen surface, a title, and a close button.
 *
 * The props are unchanged so the four call sites — round setup, Majors event
 * create, event detail's add/edit round sheets, and the playoff scorecard —
 * need no edit. `preloadedNearby` and `nearbyGpsPos` are accepted and ignored:
 * the browser does its own single-radius sweep, and threading a 5 km preload
 * into a 25 km list was the sort of near-match that produced two different
 * answers to "what's nearby" in the first place.
 */
export function CoursePickerModal({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (courseId: string, courseName?: string) => void;
  /** @deprecated CourseBrowser loads its own nearby list. */
  preloadedNearby?: unknown;
  /** @deprecated CourseBrowser resolves its own position. */
  nearbyGpsPos?: unknown;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[color:var(--ciaga-ground)]">
      <div className="mx-auto flex min-h-0 w-full max-w-sm flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6">
        <header className="flex shrink-0 items-center justify-between pb-3">
          <h2 className="text-[length:var(--t-fig)] font-semibold text-[color:var(--sec-text)]">
            Select course
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full text-[color:var(--sec-muted)] transition-colors hover:bg-[color:var(--sec-surface)] hover:text-[color:var(--sec-text)]"
          >
            <X size={20} />
          </button>
        </header>

        <CourseBrowser
          mode="select"
          onSelect={(courseId, courseName) => {
            onSelect(courseId, courseName);
            onClose();
          }}
        />
      </div>
    </div>
  );
}

export default CoursePickerModal;
