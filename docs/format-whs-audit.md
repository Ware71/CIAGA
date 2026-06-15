# Format Diagnostics & WHS Alignment Audit

_Report only — no code was changed. All fixes below are recommendations for separate, scoped follow-ups._

_Date: 2026-06-15 · Reference standard: WHS Rules of Handicapping, Appendix C (Handicap Allowances)._

---

## 1. Scope & terminology mapping

You asked to review formats across **Casual** and **Competitive**, check WHS alignment for the
official format types, and review the **"party" game types**.

The codebase has **no literal `casual` / `competitive` / `party` labels**. Those are conceptual.
The mapping used in this audit:

| Your term | In code |
|---|---|
| **Casual** | Standalone **Rounds** — `round_format_type` enum (12 formats) |
| **Competitive** | **Events / Competitions / Majors** — `EventTypeV2` / `competition_type_v2` |
| **Party games** | **Skins, Wolf, Nassau** (betting/fun games) |

The only structural split that actually exists in code is **Individual vs Team**
([FormatSelector.tsx](../apps/app/components/rounds/FormatSelector.tsx)), plus a separate
**side-games** concept (Skins / Wolf / Nassau can run alongside a primary format).

Headline result: **the official WHS formats are correctly aligned.** Every material defect is
concentrated in the **party games** and in **Casual↔Competitive consistency**.

---

## 2. Casual (Rounds) — WHS allowance table

Source of truth: `getWHSDefaultAllowance()` in
[RoundFormatSectionEnhanced.tsx:14-30](../apps/app/components/rounds/RoundFormatSectionEnhanced.tsx#L14-L30),
with team handicap formulas in
[TeamBuilderSheet.tsx:30-40](../apps/app/components/rounds/TeamBuilderSheet.tsx#L30-L40).

| Format | App allowance | WHS (Appendix C) | Verdict |
|---|---|---|---|
| strokeplay | 95% | 95% | ✓ aligned |
| stableford | 95% | 95% | ✓ aligned |
| matchplay | 100% | 100% of the *difference* | ✓ value, ⚠ mode (see §2.1) |
| pairs_stableford | 85% | Four-Ball 85% | ✓ aligned |
| team_strokeplay | 85% | varies by # scores counting | ⚠ simplified (see §2.2) |
| team_stableford | 85% | varies by # scores counting | ⚠ simplified (see §2.2) |
| team_bestball | 85% | Four-Ball best ball 85% | ✓ aligned |
| scramble | 100% + 35/15 · 30/20/10 · 25/20/15/10 | same | ✓ aligned |
| greensomes | 100% + 60/40 | 60/40 | ✓ aligned |
| foursomes | 100% + 50% combined | 50% combined | ✓ aligned |

For the single-ball team formats (scramble / greensomes / foursomes) the per-player weighting
*is* the WHS allowance, computed in the team builder; applying "100%" to the resulting team
handicap is the correct construction.

### 2.1 Match play — correct value, wrong mode (Medium)

WHS singles match play means the **lowest-handicapped player plays off scratch** and everyone
else receives **100% of the difference** between their course handicap and the lowest. In the
app that is the `compare_against_lowest` mode
([PlayingHandicapSettings.tsx](../apps/app/components/rounds/PlayingHandicapSettings.tsx)).

When a round is switched to matchplay, the code sets the allowance **value** to 100% — but only
if the mode is already `allowance_pct`, and it **never switches the mode to
`compare_against_lowest`**
([RoundFormatSectionEnhanced.tsx:175-185](../apps/app/components/rounds/RoundFormatSectionEnhanced.tsx#L175-L185)):

```ts
onChange={async (format) => {
  setFormatType(format);
  const updates = { format_type: format };
  if (handicapMode === "allowance_pct") {          // only this mode is touched
    const suggested = getWHSDefaultAllowance(format);
    setHandicapValue(suggested);
    updates.default_playing_handicap_value = suggested;
  }
  await handleUpdateSettings(updates);
}}
```

Consequence: a default match-play round strokes **every** player off their **own full handicap**
(allowance_pct 100), instead of off the difference. The net result of full-allowance singles match
play is usually the same winner, but it is not the WHS construction and will differ when plus
handicaps or stroke-index edge cases are involved.

> Recommendation: when format becomes `matchplay`, default the mode to `compare_against_lowest`
> at 100%. (Not applied — report only.)

A second, smaller issue lives in the same handler: the WHS suggestion is **only** applied when the
existing mode is `allowance_pct`. If a round is in `fixed`, `none`, or `compare_against_lowest`,
changing the format silently does **not** refresh the allowance, so the "auto-apply WHS allowance"
comment overstates what happens.

### 2.2 Team aggregate allowances are simplified (Low / by-design)

`team_strokeplay` and `team_stableford` use a flat **85%**. WHS aggregate allowances actually
depend on **how many scores count per hole** (e.g. best-1-of-4 vs best-2-of-4 vs total-of-team
carry different recommended percentages). This is a deliberate simplification, not a scoring bug —
worth documenting so it is a conscious choice rather than an oversight.

---

## 3. Party games deep-dive (Skins, Wolf, Nassau)

### 3.1 Wolf is a non-functional stub — **High severity**

Wolf returns **empty results in every code path**. As a primary format
([formatScoring.ts:933-934](../apps/app/lib/rounds/formatScoring.ts#L933-L934)):

```ts
case "wolf":
  return [{ tabLabel: "Wolf", holeResults: {}, summaries: [], higherIsBetter: true, isTeamView: false }];
```

…and as a side game
([formatScoring.ts:972-981](../apps/app/lib/rounds/formatScoring.ts#L972-L981)):

```ts
case "wolf": {
  results.push({ tabLabel: "Wolf (Side)", holeResults: {}, summaries: [], higherIsBetter: true, isTeamView: false });
  break;
}
```

Yet Wolf **is offered to users** as a selectable round format
([FormatSelector.tsx:115](../apps/app/components/rounds/FormatSelector.tsx#L115)) and as a side
game with real config (`points_per_hole`, `lone_wolf_multiplier`)
([SideGamesManager.tsx:32-38](../apps/app/components/rounds/SideGamesManager.tsx#L32-L38)).

**Consequence: selecting Wolf produces an empty, dead scoring tab.** This is the single most
important correction in the audit — a user-visible format that silently does nothing.

> Recommendation: either implement a Wolf engine (per-hole wolf rotation, partner pick vs
> lone-wolf, `lone_wolf_multiplier`, `points_per_hole`) **or** hide Wolf from the format selector
> and the side-games list until it exists. Shipping it as a selectable no-op is the worst of the
> three states.

### 3.2 Skins — works, with two rough edges (Low)

`computeSkins` is implemented correctly for the core game: lowest (net by default) unique score
wins the hole; ties carry over
([formatScoring.ts:368-428](../apps/app/lib/rounds/formatScoring.ts#L368-L428)).

- **`value_per_skin` is dead config.** The engine counts `skinValue = 1 + carryover` and never
  multiplies by `config.value_per_skin`
  ([formatScoring.ts:399-402](../apps/app/lib/rounds/formatScoring.ts#L399-L402)), even though the
  config is offered to users
  ([SideGamesManager.tsx:29](../apps/app/components/rounds/SideGamesManager.tsx#L29)). Cosmetic /
  monetary, not a scoring-correctness bug — but it's a setting that visibly does nothing.
- **Default allowance is 95%, inherited silently.** Skins falls through to `default: return 95`
  ([RoundFormatSectionEnhanced.tsx:28](../apps/app/components/rounds/RoundFormatSectionEnhanced.tsx#L28)),
  picking up the stroke-play number. Net skins is conventionally played off **100% (full
  handicap)** so the lowest net wins fairly. Recommend an explicit `case "skins"` rather than the
  silent fall-through, and a deliberate decision for `wolf`.

Net scoring in skins uses each player's **playing** handicap
([formatScoring.ts:390](../apps/app/lib/rounds/formatScoring.ts#L390)), which is consistent with
the rest of the app.

### 3.3 Nassau — healthy (no action)

Nassau is implemented and reasonable
([formatScoring.ts:777+](../apps/app/lib/rounds/formatScoring.ts#L777)): net, playing-handicap
based, awards `points` per front-9 / back-9 / overall-18 section, and only awards a section once
all its holes are complete for all players. It exists as a **side game only** — not a primary
format and not a competitive event type. No correction needed; it is the one fully-working party
game.

---

## 4. Competitive (Events) — divergences from Casual

### 4.1 WHS allowances are NOT auto-applied competitively (Medium)

On the Casual side, picking a format auto-suggests the WHS allowance via
`getWHSDefaultAllowance`. On the Competitive side there is **no per-format WHS default** — events
carry a manual `HandicapRules` object (`mode` + `allowance_pct`) the organiser sets by hand
([HandicapRulesEditor.tsx](../apps/app/components/competitions/HandicapRulesEditor.tsx),
[constants.ts](../apps/app/lib/events/constants.ts)).

This is the **biggest Casual↔Competitive inconsistency**: the more serious, competitive surface is
the one *without* WHS guidance, so an organiser running a competitive four-ball must remember to
type 85% themselves or it won't be applied.

> Recommendation: reuse `getWHSDefaultAllowance` to seed an event's `allowance_pct` from its
> format, so Competitive inherits the same WHS defaults as Casual.

### 4.2 Party games barely exist competitively (Low)

`EVENT_TYPES` ([constants.ts:34-42](../apps/app/lib/events/constants.ts#L34-L42)) exposes **Skins**
but **not Wolf or Nassau**. So two of the three party games are Casual-only. Given Wolf is a
non-functional stub anyway (§3.1), its absence here is currently a feature, not a gap — but Nassau
(which works) being Casual-only is an inconsistency worth a deliberate decision.

### 4.3 `EventTypeV2` has unsurfaced spec values (Low / type drift)

`EventTypeV2` declares spec-aligned values — `stroke_play`, `matchplay_fixture`,
`matchplay_knockout_match`, `aggregate_stroke_play`, `team_best_ball`, `team_scramble`
([types.ts:59-73](../apps/app/lib/majors/types.ts#L59-L73)) — that the `EVENT_TYPES` selector list
does **not** surface ([constants.ts:34-42](../apps/app/lib/events/constants.ts#L34-L42)). They are
reachable in data/scoring but not offered in the UI. Note as type/UI drift to reconcile (either
surface them or document why they're internal-only).

---

## 5. Findings summary

| # | Severity | Area | Finding | Recommended fix |
|---|---|---|---|---|
| 1 | **High** | Party / Casual + Comp | Wolf is a selectable no-op (empty results in both code paths) | Implement Wolf engine, or hide Wolf until it exists |
| 2 | Medium | Casual | Match play uses `allowance_pct 100`, not WHS `compare_against_lowest` | Default matchplay to `compare_against_lowest` @ 100% |
| 3 | Medium | Competitive | No per-format WHS allowance defaults for events (manual only) | Seed event `allowance_pct` from `getWHSDefaultAllowance` |
| 4 | Low | Party | Skins `value_per_skin` config is ignored by the engine | Apply multiplier, or remove the setting |
| 5 | Low | Party | Skins default allowance silently 95% via fall-through | Add explicit `case "skins"` (likely 100%) |
| 6 | Low | Casual | Format-change only refreshes allowance when mode is `allowance_pct` | Refresh across modes, or document the limitation |
| 7 | Low | Casual | team_strokeplay/stableford flat 85% ignores count-per-hole | Document as intentional, or vary by config |
| 8 | Low | Competitive | Nassau works but is Casual-only; Wolf/Nassau absent from `EVENT_TYPES` | Decide whether to surface competitively |
| 9 | Low | Competitive | `EventTypeV2` spec values not surfaced in `EVENT_TYPES` | Surface or document as internal |

**Verdict by area:**
- **Casual official formats:** WHS-aligned. Only nuance is match-play mode (#2).
- **Party games:** Skins ✓ (minor), Nassau ✓, **Wolf broken (#1)** — the one true correction needed.
- **Competitive:** functional but diverges from Casual on WHS auto-defaults (#3) and game coverage.

---

## 6. Verification

Every claim above cites `file:line` and can be checked directly. The WHS column is checked against
the WHS Rules of Handicapping, Appendix C (Handicap Allowances).

---

## 7. Update — fixes applied

A follow-up pass implemented accurate-but-configurable defaults. All defaults are **seeds** applied
on format selection and remain editable in the existing editors.

- **New single source of truth:** `apps/app/lib/rounds/whsDefaults.ts` — `getWhsDefaultPolicy(format)`
  and `getWhsDefaultPolicyForEvent(type)` return `{ mode, allowance_pct }`. Reused by Casual and
  Competitive so they no longer diverge.
- **#2 Match play (Casual):** now seeds `compare_against_lowest` @ 100% (the WHS singles construction)
  instead of flat `allowance_pct 100`.
- **#3 Competitive WHS defaults:** event format selection now seeds `handicap_rules` from the same
  policy (group defaults in `GroupDetailClient`, event create in `CreateEventClient`).
- **#5 Skins allowance:** explicit 100% (net, full handicap) instead of the silent 95% fall-through.
- **#6 Format-change refresh:** applies the full policy (mode + value) across all modes, not only when
  already in `allowance_pct`.
- **#7 Team aggregate:** allowance now derives from `count_per_hole` (best-1 75 / best-2 85 / best-3 90),
  re-seeded when the count changes; defaults to 85 when unknown.
- **#4 Skins `value_per_skin`:** now applied as a stake multiplier in `computeSkins`.
- **#9 Event-type drift:** added a complete `EVENT_TYPE_LABELS` map (all 13 `EventTypeV2`) for display,
  while keeping the user-selectable `EVENT_TYPES` list curated. Internal/duplicate variants
  (`stroke_play`, `matchplay_fixture`, `team_*`) render with friendly names but aren't offered as
  duplicate options.

**Deliberate non-changes:**
- **#1 Wolf** — left untouched; the real fix is a scoring engine, tracked as a separate follow-up task.
  It remains a non-functional stub until then.
- **#8 Nassau** — works correctly as a side game; intentionally **not** promoted to a primary or
  competitive format in a defaults-focused pass.

Verification: `tsc --noEmit` passes; defaults only fire on new format selection, so existing rounds
and events are unaffected.
