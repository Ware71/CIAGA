-- Fix two table names in sandbox_full_reset_database() that were renamed
-- in 20260528004504_rename_competition_to_event.sql:
--   competition_winnings            → event_winnings
--   competition_player_freeze_snapshots → event_player_freeze_snapshots
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
    prize_pot_payouts,
    prize_pot_entries,
    prize_pots,
    group_season_standings_entries,
    event_player_freeze_snapshots,
    event_winnings,
    competition_event_templates,
    competitions,
    major_group_standings,
    major_group_memberships,
    group_balance_transactions,
    group_charges,
    group_seasons,
    major_groups,
    event_waitlist,
    event_extras,
    event_audit_log,
    event_leaderboard_entries,
    event_round_submissions,
    event_rounds,
    event_player_charges,
    event_charges,
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
