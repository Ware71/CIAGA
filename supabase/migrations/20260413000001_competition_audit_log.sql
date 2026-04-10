-- ============================================================
-- Majors: competition_audit_log
-- Audit trail for all significant competition actions.
-- Also updates ciaga_accept_round_submission to emit an audit row.
-- ============================================================

-- ── competition_audit_log table ───────────────────────────────
CREATE TABLE public.competition_audit_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id    uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  actor_profile_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action_type       text NOT NULL,
  payload           jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_competition ON public.competition_audit_log(competition_id);
CREATE INDEX idx_audit_log_created ON public.competition_audit_log(created_at DESC);

ALTER TABLE public.competition_audit_log ENABLE ROW LEVEL SECURITY;

-- Members of the competition's group can read audit log
CREATE POLICY "competition_audit_log_select"
  ON public.competition_audit_log FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.competitions c
      JOIN public.major_group_memberships mgm ON mgm.group_id = c.group_id
      JOIN public.profiles p ON p.id = mgm.profile_id
      WHERE c.id = competition_audit_log.competition_id
        AND p.owner_user_id = auth.uid()
        AND mgm.status = 'active'
        AND mgm.role IN ('owner', 'admin')
    )
  );

GRANT SELECT ON public.competition_audit_log TO authenticated;
GRANT ALL ON public.competition_audit_log TO service_role;

-- ── Update ciaga_accept_round_submission to emit audit row ────
CREATE OR REPLACE FUNCTION public.ciaga_accept_round_submission(p_submission_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_competition_id uuid;
  v_group_id       uuid;
  v_profile_id     uuid;
BEGIN
  UPDATE competition_round_submissions
  SET
    accepted          = true,
    rejected_reason   = NULL,
    submission_status = 'accepted',
    decided_at        = NOW()
  WHERE id = p_submission_id
  RETURNING competition_id, profile_id INTO v_competition_id, v_profile_id;

  IF v_competition_id IS NULL THEN
    RAISE EXCEPTION 'Submission not found: %', p_submission_id;
  END IF;

  PERFORM ciaga_compute_competition_leaderboard(v_competition_id);

  -- Refresh group standings if this competition contributes
  SELECT group_id INTO v_group_id
  FROM competitions
  WHERE id = v_competition_id
    AND standings_contribution IN ('season', 'both');

  IF v_group_id IS NOT NULL THEN
    PERFORM ciaga_compute_group_standings(v_group_id);
  END IF;

  -- Emit audit log entry
  INSERT INTO competition_audit_log (competition_id, actor_profile_id, action_type, payload)
  VALUES (
    v_competition_id,
    v_profile_id,
    'submission_accepted',
    jsonb_build_object('submission_id', p_submission_id)
  );
END;
$$;
