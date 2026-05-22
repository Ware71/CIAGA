import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type CompetitionMajorsStatus =
  | "upcoming"
  | "live"
  | "completed"
  | "cancelled"
  | "draft"
  | "published"
  | "entry_open"
  | "entry_closed"
  | "unofficial"
  | "official"
  | "archived";

const NON_AUTO_STATUSES: CompetitionMajorsStatus[] = ["cancelled", "archived"];

/**
 * Computes and persists the correct majors_status for a competition based on:
 * - competition_date vs today
 * - round statuses (scheduled / live / completed)
 * - whether any tee times exist
 *
 * Called server-side from GET and round PATCH routes so any user activity
 * triggers a transparent status sync — no client-side logic needed.
 */
export async function reconcileCompetitionStatus(
  competitionId: string
): Promise<void> {
  const [compResult, roundsResult, teeTimesResult] = await Promise.all([
    supabaseAdmin
      .from("competitions")
      .select("majors_status, competition_date")
      .eq("id", competitionId)
      .maybeSingle(),
    supabaseAdmin
      .from("competition_rounds")
      .select("status")
      .eq("competition_id", competitionId),
    supabaseAdmin
      .from("competition_tee_times")
      .select("id", { count: "exact", head: true })
      .eq("competition_id", competitionId),
  ]);

  const comp = compResult.data as { majors_status: CompetitionMajorsStatus; competition_date: string | null } | null;
  if (!comp) return;

  if (NON_AUTO_STATUSES.includes(comp.majors_status)) return;

  const rounds = (roundsResult.data ?? []) as { status: string }[];
  const teeTimeCount = teeTimesResult.count ?? 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let target: CompetitionMajorsStatus | null = null;

  if (comp.competition_date) {
    const compDate = new Date(comp.competition_date);
    compDate.setHours(0, 0, 0, 0);

    const daysDiff = (today.getTime() - compDate.getTime()) / (1000 * 60 * 60 * 24);

    const allRoundsCompleted =
      rounds.length > 0 && rounds.every((r) => r.status === "completed");
    const anyRoundLive = rounds.some((r) => r.status === "live");

    if (daysDiff >= 1 && teeTimeCount > 0 && allRoundsCompleted) {
      target = "completed";
    } else if (daysDiff >= 0 || anyRoundLive) {
      target = "live";
    } else {
      target = "upcoming";
    }
  }

  if (target && target !== comp.majors_status) {
    await supabaseAdmin
      .from("competitions")
      .update({ majors_status: target })
      .eq("id", competitionId);
  }
}
