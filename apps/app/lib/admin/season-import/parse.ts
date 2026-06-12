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
// Scores sheet columns (v5, 1-based):
//   1=event_name, 2=player_label, 3=handicap_index, 4=round_number, 5=tee_time,
//   6-23=holes 1-18, 24=course_handicap, 25=playing_handicap, 26=event_id, 27=profile_id
//   tee_time (HH:MM, optional): players sharing (event, round, tee time) form one
//   scorecard group → one rounds row, like a real tee-time group on the day.
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

export const TEMPLATE_VERSION = "v5";

// ── Cell readers ──────────────────────────────────────────────────────────────
// ExcelJS cell values come in many shapes besides string/number: formula results
// ({ formula, result }), cached ERROR results ({ result: { error: "#N/A" } }),
// auto-created hyperlinks ({ text, hyperlink }) when someone types an email,
// rich text ({ richText: [...] }) from formatted pastes, and JS Dates for typed
// dates. Naive String(v) turns the object shapes into "[object Object]", which
// then leaks into uuid queries — normalise every shape and never stringify an
// unknown object.

/** Unwrap object-shaped ExcelJS values to a primitive (or null when unusable). */
function unwrapCellValue(v: unknown): string | number | Date | null {
  if (v == null || v === "") return null;
  if (typeof v === "string" || typeof v === "number") return v;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("error" in o) return null;                                   // cached #N/A / #VALUE! etc.
    if ("result" in o) return unwrapCellValue(o.result);             // formula / shared formula
    if ("richText" in o && Array.isArray(o.richText)) {
      return (o.richText as Array<{ text?: string }>).map(t => t.text ?? "").join("");
    }
    if ("text" in o) return unwrapCellValue(o.text);                 // hyperlink cells
    return null;                                                     // unknown shape — never "[object Object]"
  }
  return String(v);
}

export function cellString(cell: ExcelJS.Cell): string {
  const v = unwrapCellValue(cell.value);
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10); // typed dates → YYYY-MM-DD
  return String(v).trim();
}

export function cellNumber(cell: ExcelJS.Cell): number | null {
  const v = unwrapCellValue(cell.value);
  if (v == null || v instanceof Date) return null;
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Reads a tee-time cell as "HH:MM". Excel converts typed times into time
 * serials (fraction of a day) or Date objects, so a plain string read would
 * return garbage like "0.5888…" — normalise all three representations.
 */
export function cellTime(cell: ExcelJS.Cell): string | null {
  const v = unwrapCellValue(cell.value);
  if (v == null) return null;
  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
  }
  if (typeof v === "number") {
    const mins = Math.round((v % 1) * 24 * 60);
    return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  return s || null;
}

/** True when the value looks like a Postgres uuid — guards id columns so junk
 * from edited RED cells never reaches a uuid query. */
export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
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
  tee_time: string | null;  // HH:MM — groups players into separate scorecards
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

/**
 * Validates every resolved id field against the uuid shape and blanks out the
 * bad ones so they can never reach a uuid query. Returns one pointed error per
 * bad cell — almost always caused by someone editing/pasting over a RED column
 * or saving the sheet while its formulas showed errors.
 */
export function sanitizeParsedIds(parsed: ParsedWorkbook): string[] {
  const errors: string[] = [];
  const HINT = "the RED columns may have been edited or didn't calculate — re-download the template and don't type or paste over red cells";

  const check = (value: string, setBlank: () => void, label: string) => {
    if (!value || isUuid(value)) return;
    setBlank();
    errors.push(`${label}: the red id cell didn't resolve to a valid id ("${value.slice(0, 40)}") — ${HINT}.`);
  };

  for (const c of parsed.competitions) {
    check(c.event_id,    () => { c.event_id = ""; c.is_new_event = true; }, `Competitions sheet "${c.event_name}" (event_id)`);
    check(c.course_id,   () => { c.course_id = ""; },                       `Competitions sheet "${c.event_name}" (course_id)`);
    check(c.tee_box_id,  () => { c.tee_box_id = ""; },                      `Competitions sheet "${c.event_name}" (tee_box_id)`);
    if (c.template_id) {
      const raw = c.template_id.startsWith("comp_") ? c.template_id.slice(5) : c.template_id;
      if (!isUuid(raw)) {
        errors.push(`Competitions sheet "${c.event_name}" (template_id): the red id cell didn't resolve to a valid id — ${HINT}.`);
        c.template_id = "";
      }
    }
  }
  for (const s of parsed.scores) {
    check(s.profile_id,     () => { s.profile_id = ""; },     `Scores sheet "${s.player_label}" / ${s.competition_name} (profile_id)`);
    check(s.competition_id, () => { s.competition_id = ""; }, `Scores sheet "${s.player_label}" / ${s.competition_name} (event_id)`);
  }
  for (const r of parsed.eventRounds) {
    check(r.course_id,  () => { r.course_id = ""; },  `Event Rounds "${r.event_name}" round ${r.round_number} (course_id)`);
    check(r.tee_box_id, () => { r.tee_box_id = ""; }, `Event Rounds "${r.event_name}" round ${r.round_number} (tee_box_id)`);
  }
  for (const p of parsed.pots)     check(p.event_id,   () => { p.event_id = ""; },   `Prizes sheet "${p.pot_name}" (event_id)`);
  for (const p of parsed.payouts) {
    check(p.event_id,   () => { p.event_id = ""; },   `Payouts sheet "${p.player_label}" (event_id)`);
    check(p.profile_id, () => { p.profile_id = ""; }, `Payouts sheet "${p.player_label}" (profile_id)`);
  }
  for (const c of parsed.charges) {
    check(c.event_id,   () => { c.event_id = ""; },   `Charges sheet "${c.charge_name}" (event_id)`);
    check(c.profile_id, () => { c.profile_id = ""; }, `Charges sheet "${c.charge_name}" / ${c.player_label} (profile_id)`);
  }
  for (const p of parsed.payments) {
    check(p.event_id,   () => { p.event_id = ""; },   `Payments sheet "${p.player_label}" (event_id)`);
    check(p.profile_id, () => { p.profile_id = ""; }, `Payments sheet "${p.player_label}" (profile_id)`);
  }
  for (const p of parsed.playoffs) {
    check(p.event_id,   () => { p.event_id = ""; },   `Playoffs sheet "${p.event_name}" (event_id)`);
    check(p.profile_id, () => { p.profile_id = ""; }, `Playoffs sheet "${p.player_label}" (profile_id)`);
  }

  return errors;
}

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
      tee_time:              cellTime(row.getCell(26)),           // Z
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
    for (let h = 0; h < 18; h++) holes.push(cellNumber(row.getCell(6 + h)) ?? 0); // F-W
    scores.push({
      competition_name: compName,
      competition_id:   cellString(row.getCell(26)), // Z
      player_label:     playerLabel,
      profile_id:       cellString(row.getCell(27)), // AA
      handicap:         cellNumber(row.getCell(3)),
      round_number:     cellNumber(row.getCell(4)) ?? 1,
      tee_time:         cellTime(row.getCell(5)), // E
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
      tee_time:     cellTime(row.getCell(4)),           // D
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
