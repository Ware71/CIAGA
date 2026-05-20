-- Full sandbox reset: wipes everything including courses, tee data, and profiles.
-- Used by pull-from-prod before writing a production snapshot.
-- Only callable in sandbox env (guarded at the API route level).
CREATE OR REPLACE FUNCTION sandbox_full_reset_database()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  TRUNCATE TABLE
    user_notifications,
    profile_competition_stats,
    event_history_summaries,
    matchplay_league_table_entries,
    matchplay_bracket_slots,
    matchplay_fixtures,
    matchplay_stages,
    season_standings_entries,
    series_seasons,
    series_event_templates,
    competition_series,
    major_group_standings,
    major_group_memberships,
    major_groups,
    competition_waitlist,
    competition_extras,
    competition_audit_log,
    competition_leaderboard_entries,
    competition_round_submissions,
    competition_rounds,
    competition_tee_times,
    competition_entries,
    competitions,
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
