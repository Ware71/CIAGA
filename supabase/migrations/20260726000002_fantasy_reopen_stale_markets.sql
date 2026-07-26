-- Fantasy Picks V5.1 — repair per-player markets left stuck in a non-'open'
-- status inside events that are NOT yet final. `writeSnapshots` skips non-open
-- markets, so they never reprice and the board renders a greyed/blank cell
-- (the "2+ birdies dead while 1+/3+ are bettable" symptom). No current code path
-- selectively settles/suspends a single per-player market — this is residual
-- corrupt state (most likely the pre-V7 blanket-supersede bug).
--
-- Reset EVENT-WIDE markets only: round-scoped markets (params->>'round' NOT NULL)
-- are legitimately settled mid-event in live multi-round events, so leave them.
-- Full event settlement always sets is_final = true, so an event-wide non-open
-- market in a non-final event is unambiguously stale. Mark the affected events
-- stale so they reprice on next view (the refresh writes the missing snapshots
-- at the current version; no version bump needed).

BEGIN;

WITH reopened AS (
  UPDATE public.fantasy_markets m
    SET status = 'open'
    FROM public.fantasy_event_state s
    WHERE m.event_id = s.event_id
      AND s.is_final = false
      AND m.status IN ('settled', 'suspended')
      AND (m.params->>'round') IS NULL
    RETURNING m.event_id
)
UPDATE public.fantasy_event_state s
  SET odds_stale = true, updated_at = now()
  WHERE s.event_id IN (SELECT DISTINCT event_id FROM reopened);

COMMIT;
