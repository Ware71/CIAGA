-- Fantasy Picks V5.1 — collapse the duplicate score_band / score_total /
-- finish_position markets that projection/field-size drift spawned (their
-- drifting values used to live in params, which is part of market identity), and
-- normalize the survivors to the new STABLE identity so future generation stops
-- duplicating them.
--
-- Picks and parlay legs cascade-delete with their market, so they are REPOINTED
-- onto the canonical sibling BEFORE the duplicates are dropped — every open bet
-- is preserved and settles/cashes on the exact band/value it backed (the
-- selection_key is self-describing). Snapshots cascade-drop and are regenerated
-- on the next refresh.

BEGIN;

-- Duplicate → canonical map, grouped by (event, type, subject, basis). basis
-- only distinguishes score_band/score_total; finish_position groups by subject.
CREATE TEMPORARY TABLE _fantasy_dedupe ON COMMIT DROP AS
WITH grp AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY event_id, market_type, subject_profile_id,
        CASE WHEN market_type IN ('score_band', 'score_total')
             THEN COALESCE(params->>'basis', 'gross') ELSE '' END
      ORDER BY id
    ) AS canonical_id
  FROM public.fantasy_markets
  WHERE market_type IN ('score_band', 'score_total', 'finish_position')
)
SELECT id, canonical_id FROM grp WHERE id <> canonical_id;

-- Repoint bets onto the canonical market (before the duplicates are deleted).
UPDATE public.fantasy_picks p
  SET market_id = d.canonical_id
  FROM _fantasy_dedupe d
  WHERE p.market_id = d.id;

UPDATE public.fantasy_parlay_legs l
  SET market_id = d.canonical_id
  FROM _fantasy_dedupe d
  WHERE l.market_id = d.id;

-- Drop the duplicate markets (cascades their snapshots).
DELETE FROM public.fantasy_markets m
  USING _fantasy_dedupe d
  WHERE m.id = d.id;

-- Normalize survivors to the stable identity: score_band/score_total keep only
-- {basis}; finish_position keeps {}. (Offered bands/values/positions are now
-- computed per-refresh and live in snapshots, not params.)
UPDATE public.fantasy_markets
  SET params = jsonb_build_object('basis', COALESCE(params->>'basis', 'gross'))
  WHERE market_type IN ('score_band', 'score_total');

UPDATE public.fantasy_markets
  SET params = '{}'::jsonb
  WHERE market_type = 'finish_position';

COMMIT;
