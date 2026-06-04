-- ============================================================
-- Majors: Matchplay DB functions
-- ciaga_compute_matchplay_league_table — aggregates fixture results
-- ciaga_advance_matchplay_bracket — fills next-round bracket slots
-- ============================================================

-- ── ciaga_compute_matchplay_league_table ──────────────────────
-- Reads approved fixture results and updates matchplay_league_table_entries.
-- 2 pts for a win, 1 pt for a halve, 0 for a loss.
CREATE OR REPLACE FUNCTION public.ciaga_compute_matchplay_league_table(p_competition_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_stage RECORD;
BEGIN
  -- Process each stage separately (or all together if no stage is set)
  FOR v_stage IN
    SELECT DISTINCT stage_id FROM matchplay_fixtures
    WHERE competition_id = p_competition_id
      AND status = 'completed'
  LOOP
    -- Delete existing entries for this competition+stage
    DELETE FROM matchplay_league_table_entries
    WHERE competition_id = p_competition_id
      AND (stage_id = v_stage.stage_id OR (stage_id IS NULL AND v_stage.stage_id IS NULL));

    INSERT INTO matchplay_league_table_entries
      (competition_id, stage_id, profile_id, played, won, halved, lost, league_points, position, last_computed_at)
    SELECT
      p_competition_id,
      v_stage.stage_id,
      agg.profile_id,
      agg.played,
      agg.won,
      agg.halved,
      agg.lost,
      (agg.won * 2 + agg.halved)::numeric AS league_points,
      ROW_NUMBER() OVER (
        ORDER BY (agg.won * 2 + agg.halved) DESC,
                 agg.won DESC,
                 agg.lost ASC
      )::integer AS position,
      NOW() AS last_computed_at
    FROM (
      -- Aggregate wins/halves/losses for each participant across all completed fixtures
      SELECT
        participant,
        COUNT(*)                                              AS played,
        COUNT(*) FILTER (WHERE result = 'win')               AS won,
        COUNT(*) FILTER (WHERE result = 'halve')             AS halved,
        COUNT(*) FILTER (WHERE result = 'loss')              AS lost
      FROM (
        -- Home perspective
        SELECT
          ce.profile_id AS participant,
          CASE
            WHEN f.result_type IN ('home_win') THEN 'win'
            WHEN f.result_type = 'halved'      THEN 'halve'
            ELSE 'loss'
          END AS result
        FROM matchplay_fixtures f
        JOIN competition_entries ce ON ce.id = f.home_entry_id
        WHERE f.competition_id = p_competition_id
          AND f.status = 'completed'
          AND (f.stage_id = v_stage.stage_id OR (f.stage_id IS NULL AND v_stage.stage_id IS NULL))
          AND f.result_type IS NOT NULL
          AND f.result_type NOT IN ('walkover_home', 'walkover_away', 'double_withdrawal')

        UNION ALL

        -- Away perspective
        SELECT
          ce.profile_id AS participant,
          CASE
            WHEN f.result_type IN ('away_win') THEN 'win'
            WHEN f.result_type = 'halved'      THEN 'halve'
            ELSE 'loss'
          END AS result
        FROM matchplay_fixtures f
        JOIN competition_entries ce ON ce.id = f.away_entry_id
        WHERE f.competition_id = p_competition_id
          AND f.status = 'completed'
          AND (f.stage_id = v_stage.stage_id OR (f.stage_id IS NULL AND v_stage.stage_id IS NULL))
          AND f.result_type IS NOT NULL
          AND f.result_type NOT IN ('walkover_home', 'walkover_away', 'double_withdrawal')
      ) matches
      GROUP BY participant
    ) agg (profile_id, played, won, halved, lost);
  END LOOP;
END;
$$;

-- ── ciaga_advance_matchplay_bracket ───────────────────────────
-- After fixtures complete, fills bracket slots for the next round.
-- Reads matchplay_bracket_slots where source_type = 'winner_of_fixture'
-- and the source fixture is now complete.
CREATE OR REPLACE FUNCTION public.ciaga_advance_matchplay_bracket(p_competition_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_slot RECORD;
  v_winning_entry_id uuid;
  v_losing_entry_id  uuid;
BEGIN
  -- Find bracket slots that need population from completed fixtures
  FOR v_slot IN
    SELECT bs.id, bs.source_type, bs.source_fixture_id, bs.fixture_id, bs.slot_number
    FROM matchplay_bracket_slots bs
    JOIN matchplay_fixtures src_f ON src_f.id = bs.source_fixture_id
    WHERE bs.competition_id = p_competition_id
      AND bs.source_entry_id IS NULL
      AND bs.source_type IN ('winner_of_fixture', 'loser_of_fixture')
      AND src_f.status = 'completed'
      AND src_f.winning_entry_id IS NOT NULL
  LOOP
    -- Determine winner and loser entry IDs from the source fixture
    SELECT
      f.winning_entry_id,
      CASE
        WHEN f.home_entry_id = f.winning_entry_id THEN f.away_entry_id
        ELSE f.home_entry_id
      END
    INTO v_winning_entry_id, v_losing_entry_id
    FROM matchplay_fixtures f
    WHERE f.id = v_slot.source_fixture_id;

    -- Set the source_entry_id on the slot
    UPDATE matchplay_bracket_slots
    SET source_entry_id = CASE
      WHEN v_slot.source_type = 'winner_of_fixture' THEN v_winning_entry_id
      ELSE v_losing_entry_id
    END
    WHERE id = v_slot.id;

    -- If both slots for the target fixture now have entries, link them
    -- (populate home/away on the fixture when both slots are filled)
    WITH slot_entries AS (
      SELECT
        slot_number,
        source_entry_id
      FROM matchplay_bracket_slots
      WHERE fixture_id = v_slot.fixture_id
        AND source_entry_id IS NOT NULL
    )
    UPDATE matchplay_fixtures f
    SET
      home_entry_id = (SELECT source_entry_id FROM slot_entries WHERE slot_number = 1),
      away_entry_id = (SELECT source_entry_id FROM slot_entries WHERE slot_number = 2)
    WHERE f.id = v_slot.fixture_id
      AND (SELECT COUNT(*) FROM slot_entries) = 2;
  END LOOP;
END;
$$;
