-- Fix sandbox_full_reset_database() after the competition→event rename migration.
-- Step 8 of 20260528004504_rename_competition_to_event.sql missed two cases:
--   1. competition_entries was not in the substitution list (should be event_entries)
--   2. Bare `competitions` in TRUNCATE was not matched (pattern only covered FROM/JOIN/etc.),
--      so the old single-instance table (now `events`) was never cleared, and `competitions`
--      ended up listed twice causing a duplicate-relation error.
CREATE OR REPLACE FUNCTION sandbox_full_reset_database()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  TRUNCATE TABLE
    user_notifications,
    profile_event_stats,
    event_history_summaries,
    matchplay_league_table_entries,
    matchplay_bracket_slots,
    matchplay_fixtures,
    matchplay_stages,
    season_standings_entries,
    competition_seasons,
    competition_event_templates,
    competitions,
    major_group_standings,
    major_group_memberships,
    major_groups,
    event_waitlist,
    event_extras,
    event_audit_log,
    event_leaderboard_entries,
    event_round_submissions,
    event_rounds,
    event_tee_times,
    event_entries,
    events,
    handicap_round_results,
    handicap_index_history,
    invites,
    feed_comment_votes,
    feed_reports,
    feed_reactions,
    feed_item_subjects,
    feed_item_targets,
    feed_comments,
    feed_items,
    follows,
    round_sidegame_results,
    round_format_results,
    round_teams,
    round_hole_snapshots,
    round_tee_snapshots,
    round_course_snapshots,
    round_score_events,
    round_hole_states,
    round_participants,
    rounds,
    profiles,
    course_tee_holes,
    course_tee_boxes,
    courses
  CASCADE;
END;
$$;
