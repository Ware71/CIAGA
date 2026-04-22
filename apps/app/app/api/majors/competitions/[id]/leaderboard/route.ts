import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getCompetitionLeaderboard, getCompetitionSubmissionMap } from "@/lib/majors/queries";

export const runtime = "nodejs";

// GET /api/majors/competitions/[id]/leaderboard
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const [rows, submissionMap] = await Promise.all([
      getCompetitionLeaderboard(id),
      getCompetitionSubmissionMap(id),
    ]);
    const rowsWithRoundId = rows.map((r) => ({
      ...r,
      round_id: submissionMap[r.profile_id] ?? null,
    }));
    return NextResponse.json({ rows: rowsWithRoundId }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// POST /api/majors/competitions/[id]/leaderboard — admin recompute trigger
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    if (!body.recompute) {
      return NextResponse.json({ error: "Set recompute: true to trigger" }, { status: 400 });
    }

    const isAdmin = await supabaseAdmin
      .from("profiles")
      .select("is_admin")
      .eq("id", profileId)
      .maybeSingle()
      .then((r) => (r.data as any)?.is_admin === true);

    if (!isAdmin) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    await supabaseAdmin.rpc("ciaga_compute_competition_leaderboard", { p_competition_id: id });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
