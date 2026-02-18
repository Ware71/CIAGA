-- Fix: snapshot handicap_index into round_participants at round start
--
-- PROBLEM:
--   round_participants.handicap_index was never populated by any route or trigger.
--   ciaga_persist_playing_handicaps (called at round start) reads rp.handicap_index
--   to compute course_handicap_used and playing_handicap_used. With handicap_index = NULL,
--   course_handicap_used = COALESCE(round(NULL * ...), 0) = 0, meaning all players
--   scored off scratch regardless of their actual HI.
--
--   Separately, get_round_participants displayed handicap_index via a day-before lookup
--   from handicap_index_history, masking the bug. Live rounds showed the day-before HI
--   without reflecting a same-day HI update from a completed earlier round.
--
-- FIX:
--   1. ciaga_persist_playing_handicaps now snapshots the current HI from current_handicaps
--      into rp.handicap_index BEFORE computing course_handicap_used and playing_handicap_used.
--      This ensures both scoring and official HI calculations use the correct locked-in value.
--
--   2. get_round_participants now prefers rp.handicap_index (direct snapshot) over
--      handicap_index_computed (day-before history lookup) for live rounds, so display
--      correctly reflects what is actually being used for scoring.
--
-- GUEST PARTICIPANTS:
--   Guests have no profile_id so current_handicaps cannot match them. They remain at NULL
--   (scoring as 0 CH) unless a manual override is set via assigned_handicap_index.

-- ============================================================
-- 1. Update ciaga_persist_playing_handicaps
-- ============================================================

CREATE OR REPLACE FUNCTION public.ciaga_persist_playing_handicaps(p_round_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Step 1: Snapshot the current HI for all non-guest participants.
  -- current_handicaps returns the latest (highest as_of_date) handicap_index per profile.
  -- Always overwrites so that the HI active *at round start* is captured, not at round creation.
  -- For a player's second round of the day, this will correctly capture the post-round-1 HI
  -- if round 1 finished and triggered ciaga_rebuild_handicap_for_profile before this round starts.
  UPDATE public.round_participants rp
  SET handicap_index = ch.handicap_index
  FROM public.current_handicaps ch
  WHERE rp.round_id = p_round_id
    AND rp.profile_id = ch.profile_id;

  -- Step 2: Persist course_handicap_used (100% allowance, official AGS calculation) and
  --         playing_handicap_used (format scoring, respects manual overrides).
  -- Now uses the correctly populated rp.handicap_index from Step 1.
  UPDATE public.round_participants rp
  SET
    course_handicap_used = COALESCE(
      round(
        (rp.handicap_index * COALESCE(rts.slope, 113)::numeric / 113.0)
        + (COALESCE(rts.rating, rts.par_total::numeric) - COALESCE(rts.par_total, 72))
      )::integer,
      0
    ),
    playing_handicap_used = public.ciaga_resolve_playing_handicap(p_round_id, rp.id)
  FROM public.round_tee_snapshots rts
  WHERE rp.round_id = p_round_id
    AND rts.id = rp.tee_snapshot_id;
END;
$$;

COMMENT ON FUNCTION public.ciaga_persist_playing_handicaps IS
  'Called at round start to lock handicap snapshots. Prevents mid-round drift from HI/tee changes.
   Step 1: Snapshots current HI from current_handicaps into round_participants.handicap_index.
   Step 2: Computes course_handicap_used (100% allowance, for AGS) and playing_handicap_used (for format scoring).
   Guest participants (no profile_id) are skipped in step 1 and remain at NULL unless manually overridden.';

-- ============================================================
-- 2. Update get_round_participants to prefer stored snapshot
-- ============================================================
--
-- Priority for handicap_index column (resolved):
--   1. handicap_round_results.handicap_index_used  (finished rounds — locked at round completion)
--   2. round_participants.handicap_index            (live rounds — locked at round start by step above)
--   3. handicap_index_computed (day-before lookup)  (draft/fallback — pre-round history)
--
-- Similarly for course_handicap:
--   1. handicap_round_results.course_handicap_used  (finished)
--   2. round_participants.course_handicap_used       (live — locked at round start)
--   3. course_handicap_computed                      (draft/fallback)

CREATE OR REPLACE FUNCTION public.get_round_participants(_round_id uuid)
RETURNS TABLE(
  id uuid,
  profile_id uuid,
  is_guest boolean,
  display_name text,
  role text,
  tee_snapshot_id uuid,
  handicap_index numeric,
  course_handicap numeric,
  handicap_index_computed numeric,
  course_handicap_computed numeric,
  handicap_index_used numeric,
  course_handicap_used numeric,
  name text,
  email text,
  avatar_url text
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
with r as (
  select
    id as round_id,
    coalesce(started_at::date, created_at::date) as round_date
  from rounds
  where id = _round_id
  limit 1
),
tee as (
  -- Pick the tee snapshot used by this round
  select
    rts.id as tee_snapshot_id,
    rts.rating::numeric as rating,
    rts.slope::numeric as slope,
    rts.par_total::numeric as par_total
  from round_participants rp
  join round_tee_snapshots rts
    on rts.id = rp.tee_snapshot_id
  where rp.round_id = _round_id
    and rp.tee_snapshot_id is not null
  limit 1
),
computed_hi as (
  -- HI per participant as-of the day before the round date (historical baseline)
  select
    rp.id as round_participant_id,
    rp.profile_id,
    (
      select h.handicap_index::numeric
      from handicap_index_history h
      join r on true
      where h.profile_id = rp.profile_id
        and h.as_of_date <= (r.round_date - 1)
      order by h.as_of_date desc nulls last
      limit 1
    ) as handicap_index_computed
  from round_participants rp
  where rp.round_id = _round_id
    and rp.profile_id is not null
),
computed_ch as (
  select
    c.round_participant_id,
    c.profile_id,
    c.handicap_index_computed,
    case
      when c.handicap_index_computed is null then null
      when (select slope from tee) is null then null
      when (select rating from tee) is null then null
      when (select par_total from tee) is null then null
      else
        round(
          (c.handicap_index_computed * ((select slope from tee) / 113.0))
          + ((select rating from tee) - (select par_total from tee))
        )
    end as course_handicap_computed
  from computed_hi c
),
used_vals as (
  -- Values actually applied for the round (populated once round is accepted/finished)
  select
    hrr.participant_id as round_participant_id,
    hrr.handicap_index_used::numeric as handicap_index_used,
    hrr.course_handicap_used::numeric as course_handicap_used
  from handicap_round_results hrr
  where hrr.round_id = _round_id
)
select
  rp.id,
  rp.profile_id,
  rp.is_guest,
  rp.display_name,
  rp.role::text,
  rp.tee_snapshot_id,

  -- resolved: prefer used (finished), then stored snapshot (live), then computed (draft/fallback)
  coalesce(u.handicap_index_used, rp.handicap_index, cc.handicap_index_computed) as handicap_index,
  coalesce(u.course_handicap_used, rp.course_handicap_used, cc.course_handicap_computed) as course_handicap,

  -- both raw values for UI comparison
  cc.handicap_index_computed,
  cc.course_handicap_computed,
  u.handicap_index_used,
  u.course_handicap_used,

  p.name,
  p.email,
  p.avatar_url
from round_participants rp
left join profiles p
  on p.id = rp.profile_id
left join computed_ch cc
  on cc.round_participant_id = rp.id
left join used_vals u
  on u.round_participant_id = rp.id
where rp.round_id = _round_id
order by rp.created_at asc
$function$;

COMMENT ON FUNCTION public.get_round_participants IS
  'Returns participants for a round with resolved handicap values.
   handicap_index priority: handicap_round_results.handicap_index_used (finished)
                            > round_participants.handicap_index (live, locked at start)
                            > handicap_index_computed from history (draft/fallback, day before round)
   course_handicap priority: same pattern using course_handicap_used fields.';
