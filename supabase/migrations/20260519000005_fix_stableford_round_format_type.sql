-- Fix rounds created for stableford competitions that were incorrectly set to
-- format_type = 'strokeplay'. The tee-times API only checked for matchplay
-- when deriving format_type, so all stableford rounds got 'strokeplay'.
UPDATE rounds r
SET format_type = 'stableford'
FROM competition_tee_times ctt
JOIN competitions c ON c.id = ctt.competition_id
WHERE r.competition_tee_time_id = ctt.id
  AND c.competition_type = 'stableford'
  AND r.format_type = 'strokeplay';
