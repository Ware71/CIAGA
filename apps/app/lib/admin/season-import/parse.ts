import ExcelJS from "exceljs";

// ── Shared XLSX parsing for the admin season import (template v4) ─────────────
// Single source of truth for the workbook layout, used by both the preview and
// import routes so the two can never drift.
//
// Competitions sheet columns (v4, 1-based):
//   1=event_name(A), 2=event_date(B), 3=event_type(C), 4=scoring_model(D), 5=template(E),
//   6=allowance%(F), 7=season_name(G), 8=course_name(H), 9=tee_name(I), 10=entry_fee_override(J),
//   11=notes(K), 12=event_id(L), 13=is_new(M), 14=course_id(N), 15=tee_box_id(O), 16=tee_found(P),
//   17=season_id(Q), 18=default_entry_fee(R), 19=template_id(S), 20=tee_slope(T), 21=tee_rating(U),
//   22=tee_par(V), 23=allowance_resolved(W), 24=points_model_override(X), 25=field_size_override(Y),
//   26=tee_time(Z), 27=points_model_resolved(AA)
//
// Seasons sheet columns (1-based):
//   1=season_name, 2=year, 3=start_date_override, 4=end_date_override, 5=season_id
//
// Scores sheet columns (1-based):
//   1=event_name, 2=player_label, 3=handicap_index, 4=round_number, 5-22=holes 1-18,
//   23=course_handicap, 24=playing_handicap, 25=event_id, 26=profile_id
//
// Event Rounds sheet columns (v4, 1-based, optional):
//   1=event_name, 2=round_number, 3=round_date, 4=tee_time, 5=course_name, 6=tee_name,
//   7=event_id, 8=course_id, 9=tee_box_id, 10=tee_found, 11=tee_slope,
//   12=tee_rating, 13=tee_par, 14=round_key
//
// Prizes sheet columns (1-based):
//   1=event_name, 2=pot_name, 3=distribution_type, 4=entry_fee_amount, 5=metric_type,
//   6=is_monetary, 7=prize_description, 8=description, 9=event_id
//
// Payouts sheet columns (1-based):
//   1=event_name, 2=pot_name, 3=player_label, 4=position, 5=amount, 6=metric_value,
//   7=note, 8=event_id, 9=profile_id
//
// Charges sheet columns (v4, 1-based, optional):
//   1=event_name, 2=charge_name, 3=category, 4=amount, 5=player_label (blank = all entrants),
//   6=amount_override, 7=paid, 8=note, 9=event_id, 10=profile_id
//
// Payments sheet columns (v4, 1-based, optional):
//   1=player_label, 2=event_name (blank = group-level), 3=amount (blank = auto-settle),
//   4=payment_date, 5=note, 6=event_id, 7=profile_id
//
// Playoffs sheet columns (v4, 1-based, optional):
//   1=event_name, 2=resolution_type, 3=player_label, 4=final_position, 5=note,
//   6=event_id, 7=profile_id

export const TEMPLATE_VERSION = "v4";

// ── Cell readers ──────────────────────────────────────────────────────────────

export function cellString(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && "result" in v) return cellString({ value: (v as any).result } as any);
  return String(v).trim();
}

export function cellNumber(cell: ExcelJS.Cell): number | null {
  const v = cell.value;
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  if (typeof v === "object" && "result" in v) return cellNumber({ value: (v as any).result } as any);
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Parsed row types ──────────────────────────────────────────────────────────

export type ParsedSeason = {
  season_name: string;
  year: number | null;
  start_date_override: string | null;
  end_date_override: string | null;
  /** Effective dates (override, else derived from year). Empty string when underivable. */
  start_date: string;
  end_date: string;
  type: "calendar_year" | "custom";
};

export type ParsedComp = {
  event_name: string;
  event_date: string | null;
  event_type: string | null;
  scoring_model: string | null;
  template_name: string;
  template_id: string;
  allowance_pct: number | null;       // user-entered (col F), may be null
  allowance_resolved: number | null;  // effective (col W)
  season_name: string;
  course_name: string;
  tee_name: string;
  entry_fee_override: number | null;
  event_id: string;
  is_new_event: boolean;
  course_id: string;
  tee_box_id: string;
  points_model_override: string | null; // col X — blank = inherit template
  field_size_override: number | null;   // col Y — points_config.num_participants
  tee_time: string | null;              // col Z — HH:MM, blank = 09:00
};

export type ParsedScore = {
  competition_name: string; // = event_name from col A
  competition_id: string;   // resolved event_id (blank for new events at parse time)
  player_label: string;
  profile_id: string;
  handicap: number | null;
  round_number: number;
  holes: number[];
};

export type ParsedRound = {
  event_name: string;
  round_number: number;
  round_date: string | null;
  tee_time: string | null; // HH:MM override for this round
  course_id: string;
  tee_box_id: string;
};

export type ParsedPot = {
  event_name: string;
  event_id: string;
  pot_name: string;
  distribution_type: string;
  entry_fee_amount: number | null;
  metric_type: string | null;
  is_monetary: boolean;
  prize_description: string | null;
  description: string | null;
};

export type ParsedPayout = {
  event_name: string;
  event_id: string;
  pot_name: string;
  player_label: string;
  profile_id: string;
  position: number | null;
  amount: number | null;
  metric_value: number | null;
  note: string | null;
};

export type ParsedCharge = {
  event_name: string;
  event_id: string;
  charge_name: string;
  category: string;
  amount: number | null;
  player_label: string;   // blank = applies to all entrants
  profile_id: string;
  amount_override: number | null;
  paid: boolean;
  note: string | null;
};

export type ParsedPayment = {
  player_label: string;
  profile_id: string;
  event_name: string;     // blank = group-level
  event_id: string;
  amount: number | null;  // null = auto-settle outstanding imported debits
  payment_date: string | null;
  note: string | null;
};

export type ParsedPlayoff = {
  event_name: string;
  event_id: string;
  resolution_type: string; // playoff | countback
  player_label: string;
  profile_id: string;
  final_position: number | null;
  note: string | null;
};

export type ParsedWorkbook = {
  seasons: ParsedSeason[];
  competitions: ParsedComp[];
  scores: ParsedScore[];
  eventRounds: ParsedRound[];
  pots: ParsedPot[];
  payouts: ParsedPayout[];
  charges: ParsedCharge[];
  payments: ParsedPayment[];
  playoffs: ParsedPlayoff[];
};

const EMPTY: ParsedWorkbook = {
  seasons: [], competitions: [], scores: [], eventRounds: [],
  pots: [], payouts: [], charges: [], payments: [], playoffs: [],
};

// ── Parser ────────────────────────────────────────────────────────────────────

export async function parseXlsx(file: File): Promise<{ parsed: ParsedWorkbook; errors: string[] }> {
  const errors: string[] = [];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());

  // Version check — guide sheet col D row 1 contains the version marker
  const guideSheet = wb.getWorksheet("Guide");
  if (guideSheet) {
    const versionCell = cellString(guideSheet.getCell(1, 4));
    if (versionCell && versionCell !== TEMPLATE_VERSION) {
      errors.push(`This template is outdated (version "${versionCell}") — please re-download the template from Step 1.`);
      return { parsed: EMPTY, errors };
    }
    if (!versionCell) {
      errors.push(`This template is outdated (no version marker) — please re-download the template from Step 1.`);
      return { parsed: EMPTY, errors };
    }
  }

  const seasonSheet = wb.getWorksheet("Seasons");
  if (!seasonSheet) errors.push("Workbook is missing the 'Seasons' sheet");

  const compSheet = wb.getWorksheet("Competitions");
  if (!compSheet) errors.push("Workbook is missing the 'Competitions' sheet");

  const scoresSheet = wb.getWorksheet("Scores");
  if (!scoresSheet) errors.push("Workbook is missing the 'Scores' sheet");

  if (errors.length) return { parsed: EMPTY, errors };

  const seasons: ParsedSeason[] = [];
  seasonSheet!.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const name = cellString(row.getCell(1));
    if (!name) return;
    const year          = cellNumber(row.getCell(2));
    const startOverride = cellString(row.getCell(3)) || null;
    const endOverride   = cellString(row.getCell(4)) || null;
    const isCustom      = !!(startOverride || endOverride);
    seasons.push({
      season_name:         name,
      year,
      start_date_override: startOverride,
      end_date_override:   endOverride,
      start_date:          startOverride ?? (year ? `${year}-01-01` : ""),
      end_date:            endOverride   ?? (year ? `${year}-12-31` : ""),
      type:                isCustom ? "custom" : "calendar_year",
    });
  });

  const competitions: ParsedComp[] = [];
  compSheet!.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const eventName = cellString(row.getCell(1)); // A
    if (!eventName) return;
    const eventId = cellString(row.getCell(12)); // L
    competitions.push({
      event_name:            eventName,
      event_date:            cellString(row.getCell(2)) || null,  // B
      event_type:            cellString(row.getCell(3)) || null,  // C
      scoring_model:         cellString(row.getCell(4)) || null,  // D
      template_name:         cellString(row.getCell(5)),          // E
      allowance_pct:         cellNumber(row.getCell(6)),          // F
      season_name:           cellString(row.getCell(7)),          // G
      course_name:           cellString(row.getCell(8)),          // H
      tee_name:              cellString(row.getCell(9)),          // I
      entry_fee_override:    cellNumber(row.getCell(10)),         // J
      event_id:              eventId,
      is_new_event:          eventId === "",
      course_id:             cellString(row.getCell(14)),         // N
      tee_box_id:            cellString(row.getCell(15)),         // O
      template_id:           cellString(row.getCell(19)),         // S
      allowance_resolved:    cellNumber(row.getCell(23)),         // W
      points_model_override: cellString(row.getCell(24)) || null, // X
      field_size_override:   cellNumber(row.getCell(25)),         // Y
      tee_time:              cellString(row.getCell(26)) || null, // Z
    });
  });

  const scores: ParsedScore[] = [];
  scoresSheet!.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const compName    = cellString(row.getCell(1));
    if (!compName) return;
    const playerLabel = cellString(row.getCell(2));
    if (!playerLabel) return;
    const holes: number[] = [];
    for (let h = 0; h < 18; h++) holes.push(cellNumber(row.getCell(5 + h)) ?? 0); // E-V
    scores.push({
      competition_name: compName,
      competition_id:   cellString(row.getCell(25)), // Y
      player_label:     playerLabel,
      profile_id:       cellString(row.getCell(26)), // Z
      handicap:         cellNumber(row.getCell(3)),
      round_number:     cellNumber(row.getCell(4)) ?? 1,
      holes,
    });
  });

  const eventRounds: ParsedRound[] = [];
  const eventRoundsSheet = wb.getWorksheet("Event Rounds");
  eventRoundsSheet?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const eventName = cellString(row.getCell(1)); // A
    if (!eventName) return;
    const roundNum = cellNumber(row.getCell(2));  // B
    if (!roundNum) return;
    const courseId  = cellString(row.getCell(8)); // H
    const teeBoxId  = cellString(row.getCell(9)); // I
    if (!courseId || !teeBoxId) return;
    eventRounds.push({
      event_name:   eventName,
      round_number: roundNum,
      round_date:   cellString(row.getCell(3)) || null, // C
      tee_time:     cellString(row.getCell(4)) || null, // D
      course_id:    courseId,
      tee_box_id:   teeBoxId,
    });
  });

  const pots: ParsedPot[] = [];
  const prizesSheet = wb.getWorksheet("Prizes");
  prizesSheet?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const eventName = cellString(row.getCell(1)); // A
    const potName   = cellString(row.getCell(2)); // B
    if (!eventName || !potName) return;
    pots.push({
      event_name:        eventName,
      pot_name:          potName,
      distribution_type: cellString(row.getCell(3)) || "position_based", // C
      entry_fee_amount:  cellNumber(row.getCell(4)),                      // D
      metric_type:       cellString(row.getCell(5)) || null,             // E
      is_monetary:       (cellString(row.getCell(6)) || "Yes").toLowerCase() !== "no", // F
      prize_description: cellString(row.getCell(7)) || null,             // G
      description:       cellString(row.getCell(8)) || null,             // H
      event_id:          cellString(row.getCell(9)),                      // I
    });
  });

  const payouts: ParsedPayout[] = [];
  const payoutsSheet = wb.getWorksheet("Payouts");
  payoutsSheet?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const eventName   = cellString(row.getCell(1)); // A
    const potName     = cellString(row.getCell(2)); // B
    const playerLabel = cellString(row.getCell(3)); // C
    if (!eventName || !potName || !playerLabel) return;
    payouts.push({
      event_name:   eventName,
      pot_name:     potName,
      player_label: playerLabel,
      position:     cellNumber(row.getCell(4)), // D
      amount:       cellNumber(row.getCell(5)), // E
      metric_value: cellNumber(row.getCell(6)), // F
      note:         cellString(row.getCell(7)) || null, // G
      event_id:     cellString(row.getCell(8)), // H
      profile_id:   cellString(row.getCell(9)), // I
    });
  });

  const charges: ParsedCharge[] = [];
  const chargesSheet = wb.getWorksheet("Charges");
  chargesSheet?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const eventName  = cellString(row.getCell(1)); // A
    const chargeName = cellString(row.getCell(2)); // B
    if (!eventName || !chargeName) return;
    charges.push({
      event_name:      eventName,
      charge_name:     chargeName,
      category:        cellString(row.getCell(3)) || "other",   // C
      amount:          cellNumber(row.getCell(4)),               // D
      player_label:    cellString(row.getCell(5)),               // E
      amount_override: cellNumber(row.getCell(6)),               // F
      paid:            (cellString(row.getCell(7)) || "Yes").toLowerCase() !== "no", // G
      note:            cellString(row.getCell(8)) || null,       // H
      event_id:        cellString(row.getCell(9)),               // I
      profile_id:      cellString(row.getCell(10)),              // J
    });
  });

  const payments: ParsedPayment[] = [];
  const paymentsSheet = wb.getWorksheet("Payments");
  paymentsSheet?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const playerLabel = cellString(row.getCell(1)); // A
    if (!playerLabel) return;
    payments.push({
      player_label: playerLabel,
      event_name:   cellString(row.getCell(2)),          // B
      amount:       cellNumber(row.getCell(3)),          // C
      payment_date: cellString(row.getCell(4)) || null,  // D
      note:         cellString(row.getCell(5)) || null,  // E
      event_id:     cellString(row.getCell(6)),          // F
      profile_id:   cellString(row.getCell(7)),          // G
    });
  });

  const playoffs: ParsedPlayoff[] = [];
  const playoffsSheet = wb.getWorksheet("Playoffs");
  playoffsSheet?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const eventName   = cellString(row.getCell(1)); // A
    const playerLabel = cellString(row.getCell(3)); // C
    if (!eventName || !playerLabel) return;
    playoffs.push({
      event_name:      eventName,
      resolution_type: (cellString(row.getCell(2)) || "playoff").toLowerCase(), // B
      player_label:    playerLabel,
      final_position:  cellNumber(row.getCell(4)),         // D
      note:            cellString(row.getCell(5)) || null, // E
      event_id:        cellString(row.getCell(6)),         // F
      profile_id:      cellString(row.getCell(7)),         // G
    });
  });

  return {
    parsed: { seasons, competitions, scores, eventRounds, pots, payouts, charges, payments, playoffs },
    errors,
  };
}
