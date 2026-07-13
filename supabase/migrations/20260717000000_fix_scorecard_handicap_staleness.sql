-- Fix two staleness/regression bugs in get_round_participants (scorecard preview + live scorecard).
--
-- BUG 1 (regression): 20260401104823_fix_live_9hole_course_handicap.sql redefined this
--   function to add 9-hole support, but its CREATE OR REPLACE was based on a version that
--   predated 20260218000001_fix_handicap_snapshot_at_round_start.sql, silently dropping the
--   round_participants.handicap_index / .course_handicap_used snapshot tier from the resolved
--   coalesce. Result: for LIVE rounds, the scorecard displayed the day-before computed HI/CH
--   instead of the value actually locked in at round start by ciaga_persist_playing_handicaps
--   (and used for playing_handicap_used / stroke allocation) — same class of bug as
--   20260610000001_restore_handicap_index_snapshot.sql fixed on the write side.
--
-- BUG 2 (staleness): for a round that hasn't started, computed_hi's cutoff was
--   `as_of_date <= round_date - 1` where round_date falls back to created_at::date — frozen
--   at round creation, never reflecting "today". The setup screen (getSetupSnapshot.ts)
--   always shows the true latest HI, so the scorecard preview could disagree with it.
--
-- FIX:
--   1. Restore rp.handicap_index / rp.course_handicap_used into the resolved coalesce,
--      between the finished-round "used" values and the computed fallback.
--   2. For not-yet-started rounds (started_at is null), use `as_of_date <= current_date`
--      instead of `created_at::date - 1`, so the preview always reflects "now".
--      Started rounds keep the existing day-before-started_at cutoff as a defensive
--      fallback only (rp.handicap_index wins in practice once a round is live).
--   3. 9-hole halving logic from the April migration is preserved unchanged.

CREATE OR REPLACE FUNCTION public.get_round_participants(_round_id uuid)
 RETURNS TABLE(id uuid, profile_id uuid, is_guest boolean, display_name text, role text, tee_snapshot_id uuid, handicap_index numeric, course_handicap numeric, handicap_index_computed numeric, course_handicap_computed numeric, handicap_index_used numeric, course_handicap_used numeric, name text, email text, avatar_url text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with r as (
  select
    id as round_id,
    started_at,
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
    rts.par_total::numeric as par_total,
    rts.holes_count
  from round_participants rp
  join round_tee_snapshots rts
    on rts.id = rp.tee_snapshot_id
  where rp.round_id = _round_id
    and rp.tee_snapshot_id is not null
  limit 1
),
computed_hi as (
  -- HI per participant as-of "now" for not-yet-started rounds, or as-of the day
  -- before start for started rounds (WHS day-before convention; defensive fallback
  -- only, since rp.handicap_index below wins once a round is live).
  select
    rp.id as round_participant_id,
    rp.profile_id,
    (
      select h.handicap_index::numeric
      from handicap_index_history h
      join r on true
      where h.profile_id = rp.profile_id
        and h.as_of_date <= (
          case when r.started_at is null then current_date else r.round_date - 1 end
        )
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
      -- For 9-hole rounds: halve the handicap index before applying the WHS formula
      when (select holes_count from tee) = 9 then
        round(
          ((c.handicap_index_computed / 2.0) * ((select slope from tee) / 113.0))
          + ((select rating from tee) - (select par_total from tee))
        )
      else
        round(
          (c.handicap_index_computed * ((select slope from tee) / 113.0))
          + ((select rating from tee) - (select par_total from tee))
        )
    end as course_handicap_computed
  from computed_hi c
),
used_vals as (
  -- Values actually applied for the round (typically populated for finished/accepted handicap rows)
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

  -- resolved: prefer used (finished), then stored snapshot (live, locked at round start),
  -- then computed (draft/scheduled preview, or defensive fallback)
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
order by rp.created_at asc;
$function$
;

COMMENT ON FUNCTION public.get_round_participants IS
  'Returns participants for a round with resolved handicap values.
   handicap_index priority: handicap_round_results.handicap_index_used (finished)
                            > round_participants.handicap_index (live, locked at round start)
                            > handicap_index_computed from history (draft/scheduled preview — as-of
                              now for not-started rounds, as-of day-before-start otherwise as a
                              defensive fallback)
   course_handicap priority: same pattern using course_handicap_used fields.';
