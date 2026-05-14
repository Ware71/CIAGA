-- Recompute competition_leaderboard_entries for all active competitions
-- to populate the new to_par and course_par columns added in 20260514000006.
DO $$
DECLARE
  c_id uuid;
BEGIN
  FOR c_id IN
    SELECT id FROM public.competitions
    WHERE majors_status IN ('live', 'completed', 'official')
  LOOP
    PERFORM public.ciaga_compute_competition_leaderboard(c_id);
  END LOOP;
END;
$$;
