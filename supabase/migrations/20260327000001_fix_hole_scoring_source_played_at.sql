-- Fix hole_scoring_source to use the authoritative played_at from handicap_round_results,
-- falling back to finished_at > started_at > created_at instead of started_at > created_at.

create or replace view "public"."hole_scoring_source" as  WITH latest AS (
         SELECT DISTINCT ON (rse.participant_id, rse.round_id, rse.hole_number) rse.participant_id,
            rse.round_id,
            rse.hole_number,
            rse.strokes
           FROM public.round_score_events rse
          WHERE (rse.strokes IS NOT NULL)
          ORDER BY rse.participant_id, rse.round_id, rse.hole_number, rse.created_at DESC, rse.id DESC
        )
 SELECT rp.profile_id,
    l.round_id,
    COALESCE(hrr.played_at::timestamptz, r.finished_at, r.started_at, r.created_at) AS played_at,
    rcs.source_course_id AS course_id,
    rcs.course_name,
    rts.source_tee_box_id AS tee_box_id,
    rts.name AS tee_name,
    l.hole_number,
    rhs.par,
    rhs.yardage,
    rhs.stroke_index,
    l.strokes,
    (l.strokes - rhs.par) AS to_par,
    (l.strokes >= (rhs.par + 2)) AS is_double_plus,
    (l.strokes >= (rhs.par + 3)) AS is_triple_plus,
    hrr.handicap_index_used,
    hrr.course_handicap_used,
    public.ciaga_strokes_received_on_hole(
      hrr.course_handicap_used,
      rhs.stroke_index,
      CASE WHEN hrr.is_9_hole THEN 9 ELSE 18 END
    ) AS strokes_received,
    (l.strokes - public.ciaga_strokes_received_on_hole(
      hrr.course_handicap_used,
      rhs.stroke_index,
      CASE WHEN hrr.is_9_hole THEN 9 ELSE 18 END
    )) AS net_strokes,
    ((l.strokes - public.ciaga_strokes_received_on_hole(
      hrr.course_handicap_used,
      rhs.stroke_index,
      CASE WHEN hrr.is_9_hole THEN 9 ELSE 18 END
    )) - rhs.par) AS net_to_par
   FROM ((((((latest l
     JOIN public.round_participants rp ON ((rp.id = l.participant_id)))
     JOIN public.rounds r ON ((r.id = l.round_id)))
     LEFT JOIN public.round_tee_snapshots rts ON ((rts.id = rp.tee_snapshot_id)))
     LEFT JOIN public.round_course_snapshots rcs ON ((rcs.id = rts.round_course_snapshot_id)))
     LEFT JOIN public.round_hole_snapshots rhs ON (((rhs.round_tee_snapshot_id = rts.id) AND (rhs.hole_number = l.hole_number))))
     LEFT JOIN public.handicap_round_results hrr ON (((hrr.round_id = l.round_id) AND (hrr.participant_id = rp.id))));
