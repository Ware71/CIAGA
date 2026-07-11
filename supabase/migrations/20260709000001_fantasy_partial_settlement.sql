-- ============================================================
-- Fantasy V2: partial (round-scoped) settlement support.
--
-- Multi-round events settle their round-scoped markets as each round
-- completes, while event-wide markets stay open. The apply RPC gains
-- p_final (default true): when false it settles the given picks/markets
-- but does NOT flip fantasy_event_state.is_final.
--
-- The 3-arg overload is dropped (signature change), so EXECUTE grants
-- are re-applied explicitly — DROP FUNCTION resets them (2026-07 audit
-- gotcha). Service-role only, as before.
-- ============================================================

DROP FUNCTION IF EXISTS public.ciaga_fantasy_apply_settlement(uuid, jsonb, uuid[]);

CREATE FUNCTION public.ciaga_fantasy_apply_settlement(
  p_event_id uuid,
  p_outcomes jsonb,
  p_market_ids uuid[],
  p_final boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec record;
  v_pick record;
  v_season uuid;
  v_won integer := 0;
  v_lost integer := 0;
  v_void integer := 0;
BEGIN
  FOR rec IN
    SELECT (o->>'pick_id')::uuid AS pick_id, o->>'outcome' AS outcome
    FROM jsonb_array_elements(p_outcomes) AS o
  LOOP
    IF rec.outcome NOT IN ('won', 'lost', 'void') THEN
      CONTINUE;
    END IF;

    UPDATE fantasy_picks
       SET status = rec.outcome,
           settled_at = now()
     WHERE id = rec.pick_id
       AND event_id = p_event_id
       AND status = 'open'
    RETURNING id, group_id, profile_id, event_id, stake, potential_return
      INTO v_pick;

    IF v_pick.id IS NULL THEN
      CONTINUE; -- already settled/cashed out (idempotent re-run)
    END IF;

    SELECT group_season_id INTO v_season
      FROM fantasy_wallet_transactions
     WHERE pick_id = v_pick.id AND type = 'stake'
     LIMIT 1;

    IF rec.outcome = 'won' THEN
      v_won := v_won + 1;
      INSERT INTO fantasy_wallet_transactions (
        group_id, profile_id, group_season_id, event_id, pick_id, type, amount, note
      ) VALUES (
        v_pick.group_id, v_pick.profile_id, v_season, v_pick.event_id, v_pick.id,
        'payout', v_pick.potential_return, 'Pick won'
      );
    ELSIF rec.outcome = 'void' THEN
      v_void := v_void + 1;
      INSERT INTO fantasy_wallet_transactions (
        group_id, profile_id, group_season_id, event_id, pick_id, type, amount, note
      ) VALUES (
        v_pick.group_id, v_pick.profile_id, v_season, v_pick.event_id, v_pick.id,
        'void_refund', v_pick.stake, 'Pick voided — stake returned'
      );
    ELSE
      v_lost := v_lost + 1;
    END IF;
  END LOOP;

  UPDATE fantasy_markets
     SET status = 'settled', settled_at = now(), updated_at = now()
   WHERE event_id = p_event_id
     AND id = ANY(p_market_ids)
     AND status IN ('open', 'suspended');

  IF p_final THEN
    UPDATE fantasy_event_state
       SET is_final = true,
           odds_stale = false,
           changed_reason = 'settled',
           updated_at = now()
     WHERE event_id = p_event_id;
  END IF;

  RETURN jsonb_build_object('won', v_won, 'lost', v_lost, 'void', v_void);
END;
$$;

REVOKE ALL ON FUNCTION public.ciaga_fantasy_apply_settlement(uuid, jsonb, uuid[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ciaga_fantasy_apply_settlement(uuid, jsonb, uuid[], boolean) TO service_role;
