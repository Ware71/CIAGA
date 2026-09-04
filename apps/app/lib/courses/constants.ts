// lib/courses/constants.ts

/**
 * One nearby radius for the whole app.
 *
 * There used to be four: the picker opened at 5 km and had a button to refetch
 * at 20 km, /courses did a single 30 km sweep, and the worldwide hook defaulted
 * to 5 km around whichever place you picked. Same feature, three answers.
 *
 * 25 km in one request, because the endpoint already returns results sorted by
 * distance — so the nearest arrive first regardless, and the old "search wider
 * area" button was buying a second round trip for something the list could just
 * scroll to.
 */
export const NEARBY_RADIUS_M = 25000;

/**
 * Radius for "which course am I standing on", used by round setup to pre-select
 * a course for a brand-new round.
 *
 * Deliberately much tighter than NEARBY_RADIUS_M, because it answers a
 * different question. Browsing wants reach; auto-detect wants certainty, and
 * silently picking a course 20 km away would be worse than picking none.
 */
export const AUTO_DETECT_RADIUS_M = 5000;

/** How many rows the list reveals per scroll step. */
export const COURSE_PAGE_SIZE = 20;

/** Debounce before the global (Nominatim + DB) half of a search fires. */
export const SEARCH_DEBOUNCE_MS = 250;

/** Below this, only the local sources are filtered — a global search is noise. */
export const MIN_GLOBAL_QUERY = 2;
