-- Fix: sync_round_hole_states_from_events() should NOT overwrite picked_up to not_started.
-- It should:
--   1) ensure rows exist for all participants + holes (1..holes_count)
--   2) set status to completed where latest strokes exists
--   3) otherwise preserve existing status (picked_up stays picked_up)

create or replace function public.sync_round_hole_states_from_events(_round_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
set row_security to 'off'
as $$
declare
  tee_id uuid;
  holes_cnt int;
begin
  -- Pick any tee snapshot for the round (participants are assigned one on start)
  select rp.tee_snapshot_id into tee_id
  from round_participants rp
  where rp.round_id = _round_id
    and rp.tee_snapshot_id is not null
  limit 1;

  if tee_id is null then
    -- Round hasn't started / no tee snapshot assigned yet. Nothing to sync.
    return;
  end if;

  select ts.holes_count into holes_cnt
  from round_tee_snapshots ts
  where ts.id = tee_id;

  if holes_cnt is null then
    holes_cnt := 18;
  end if;

  -- Ensure a round_hole_states row exists for every participant and hole 1..holes_cnt
  insert into round_hole_states (round_id, participant_id, hole_number, status)
  select
    rp.round_id,
    rp.id,
    gs.hole_number,
    'not_started'::hole_state
  from round_participants rp
  cross join lateral (
    select generate_series(1, holes_cnt) as hole_number
  ) gs
  where rp.round_id = _round_id
  on conflict (participant_id, hole_number) do nothing;

  -- For any hole where latest score event has strokes, mark completed.
  -- If no strokes exists, preserve existing status (e.g., picked_up remains picked_up).
  with latest as (
    select distinct on (participant_id, hole_number)
      participant_id,
      hole_number,
      strokes
    from round_score_events
    where round_id = _round_id
    order by participant_id, hole_number, created_at desc
  )
  update round_hole_states hs
  set status = case
    when l.strokes is not null then 'completed'::hole_state
    else hs.status
  end
  from latest l
  where hs.round_id = _round_id
    and hs.participant_id = l.participant_id
    and hs.hole_number = l.hole_number;

end;
$$;
