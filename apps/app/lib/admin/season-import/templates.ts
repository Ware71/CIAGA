import type { SupabaseClient } from "@supabase/supabase-js";

type Admin = SupabaseClient;

export type DefaultPrizePot = {
  name: string;
  distribution_type: string;
  entry_fee_amount: number | null;
  is_mandatory?: boolean;
  is_monetary?: boolean;
};

/**
 * Fully-resolved template defaults for one Template dropdown value.
 * Template ids come from the spreadsheet as either "comp_<uuid>" (series-level)
 * or a plain uuid (competition_event_templates slot). For slots the parent
 * competition's settings are merged underneath the slot's own — the same
 * precedence the in-app create-event flow uses (applyCompetitionSettings in
 * CreateEventClient.tsx): {...comp.template_settings, ...slot.template_settings}.
 */
export type TemplateDefaults = {
  event_type: string | null;
  scoring_model: string | null;
  points_model: string | null;
  rules_text: string | null;
  allowance_pct: number | null;
  max_handicap: number | null;
  handicap_mode: string | null;
  default_prize_pots: DefaultPrizePot[] | null;
  // FKs to set on the event. For a slot BOTH are set (slot + its parent series).
  competition_id: string | null;
  competition_event_template_id: string | null;
};

/**
 * When groupId is given, templates whose (parent) competition belongs to a
 * different group are dropped from the result — callers treat a missing entry
 * as "template did not resolve".
 */
export async function resolveTemplateDefaults(
  admin: Admin,
  referencedTemplateIds: string[],
  groupId?: string,
): Promise<Map<string, TemplateDefaults>> {
  const out = new Map<string, TemplateDefaults>();
  if (!referencedTemplateIds.length) return out;

  const compSeriesIds = referencedTemplateIds.filter(id => id.startsWith("comp_")).map(id => id.slice(5));
  const eventTmplIds  = referencedTemplateIds.filter(id => !id.startsWith("comp_"));

  const COMP_FIELDS = "id,template_event_type,template_scoring_model,template_points_model,template_rules_text,template_settings,default_prize_pots";

  // Event-template slots need their parent competition for the settings merge
  type SlotRow = {
    id: string; competition_id: string;
    template_event_type: string | null; template_scoring_model: string | null;
    template_points_model: string | null; template_rules_text: string | null;
    template_settings: Record<string, any> | null;
  };
  let slotRows: SlotRow[] = [];
  if (eventTmplIds.length) {
    const { data, error } = await admin
      .from("competition_event_templates")
      .select("id,competition_id,template_event_type,template_scoring_model,template_points_model,template_rules_text,template_settings")
      .in("id", eventTmplIds);
    if (error) throw new Error(`Event template lookup failed: ${error.message}`);
    slotRows = (data ?? []) as SlotRow[];
  }

  const parentCompIds = Array.from(new Set(slotRows.map(s => s.competition_id)));
  const allCompIds    = Array.from(new Set([...compSeriesIds, ...parentCompIds]));

  type CompRow = {
    id: string;
    template_event_type: string | null; template_scoring_model: string | null;
    template_points_model: string | null; template_rules_text: string | null;
    template_settings: Record<string, any> | null;
    default_prize_pots: DefaultPrizePot[] | null;
  };
  const compById = new Map<string, CompRow>();
  if (allCompIds.length) {
    let q = admin.from("competitions").select(`${COMP_FIELDS},group_id`).in("id", allCompIds);
    if (groupId) q = q.eq("group_id", groupId);
    const { data, error } = await q;
    if (error) throw new Error(`Series template lookup failed: ${error.message}`);
    for (const c of (data ?? []) as CompRow[]) compById.set(c.id, c);
  }

  for (const compId of compSeriesIds) {
    const c = compById.get(compId);
    if (!c) continue;
    const settings = (c.template_settings ?? {}) as Record<string, any>;
    out.set(`comp_${compId}`, {
      event_type:    c.template_event_type ?? null,
      scoring_model: c.template_scoring_model ?? null,
      points_model:  c.template_points_model ?? null,
      rules_text:    c.template_rules_text ?? null,
      allowance_pct: settings.handicap_allowance_pct ?? null,
      max_handicap:  settings.max_handicap ?? null,
      handicap_mode: settings.handicap_mode ?? null,
      default_prize_pots: c.default_prize_pots?.length ? c.default_prize_pots : null,
      competition_id: compId,
      competition_event_template_id: null,
    });
  }

  for (const slot of slotRows) {
    const parent = compById.get(slot.competition_id);
    if (groupId && !parent) continue; // parent series not in this group — drop the slot
    const merged = { ...(parent?.template_settings ?? {}), ...(slot.template_settings ?? {}) } as Record<string, any>;
    out.set(slot.id, {
      event_type:    slot.template_event_type ?? parent?.template_event_type ?? null,
      scoring_model: slot.template_scoring_model ?? parent?.template_scoring_model ?? null,
      points_model:  slot.template_points_model ?? parent?.template_points_model ?? null,
      rules_text:    slot.template_rules_text ?? parent?.template_rules_text ?? null,
      allowance_pct: merged.handicap_allowance_pct ?? null,
      max_handicap:  merged.max_handicap ?? null,
      handicap_mode: merged.handicap_mode ?? null,
      default_prize_pots: parent?.default_prize_pots?.length ? parent.default_prize_pots : null,
      competition_id: slot.competition_id,
      competition_event_template_id: slot.id,
    });
  }

  return out;
}
