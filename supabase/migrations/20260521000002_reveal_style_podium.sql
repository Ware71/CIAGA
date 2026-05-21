-- Add 'podium' as a valid value for leaderboard_reveal_style
ALTER TABLE competitions
  DROP CONSTRAINT IF EXISTS competitions_leaderboard_reveal_style_check;

ALTER TABLE competitions
  ADD CONSTRAINT competitions_leaderboard_reveal_style_check
    CHECK (leaderboard_reveal_style IN ('none', 'animated', 'suspense', 'rapid', 'podium'));
