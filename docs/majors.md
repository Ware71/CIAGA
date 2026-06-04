# Majors — Product & Technical Specification (Revised)

## Overview

**Majors** is the competition management platform inside ciaga for running golf competitions across four core modes:

1. **Standalone competitions**
   - One-off stroke play events
   - One-off Stableford and other score-based events
   - One-off matchplay events

2. **Multi-round competitions**
   - Multi-round stroke play championships
   - Multi-round aggregate competitions
   - Multi-round matchplay structures where each round is a fixture or bracket stage

3. **Recurring social structures**
   - Friend-group tours
   - Golf societies and leagues
   - Annual major series
   - Season-long points races and standings

4. **Future public events**
   - Discoverable public competitions
   - Organizer-managed entry and approval flows
   - Expanded eligibility, capacity, and compliance controls

The platform must support both casual private use among friends and increasingly formal competition administration over time.

---

## Product Goals

Majors should enable organizers to:

- Run **standalone golf competitions** with low setup friction
- Run **multi-round stroke play championships**
- Run **matchplay as both**:
  - a **league** (round-robin / fixture-based)
  - a **knockout** (bracket-based)
- Manage a **society or friend-group tour** over a season
- Run a **major series** with named recurring events each year
- Preserve **historical continuity** so organizers and players can view:
  - event results by year
  - season standings by year
  - career stats across all years
  - event-specific history such as “The Invitational 2025”, “The Invitational 2026”, etc.
- Evolve into hosting **public events** later without needing a rewrite of the core domain model

---

## Design Principles

1. **Competition-first model**
   Every playable event is a competition instance with frozen rules.

2. **Series and season history are first-class**
   Recurring named events must remain linked across years.

3. **Format-specific structures should be explicit**
   Matchplay league and knockout should not be awkwardly forced into the same scoring path as stroke play.

4. **Rules must be frozen per competition instance**
   Templates are editable; instantiated competitions are historical records.

5. **History and stats are product features, not reporting afterthoughts**
   Event history, season history, and profile stats must be queryable directly from the model.

6. **Private now, public later**
   Permissions, eligibility, and entry workflows should support future public competition hosting.

---

## Core Domain Model

The revised model separates:
- **organizations / groups** that host competitions
- **series / tours / seasons** that structure repeated competition
- **competition instances** that are actually played
- **format-specific competition data** for stroke play and matchplay
- **historical records and stat summaries**

---

## Primary Concepts

### 1. Host Groups
A host group is the top-level container for competition activity.

Examples:
- a golf society
- a friend group
- a private tour
- a public organizer brand
- a season-specific league container

A host group can own:
- one-off competitions
- tours
- leagues
- recurring series
- public events in the future

### 2. Competition Series
A competition series is a recurring structure that links named events over time.

Examples:
- “Friends Majors”
- “Summer Tour”
- “Winter Matchplay League”
- “The Invitational” as a recurring event within a major series

A series may represent:
- a major series
- a society tour
- an annual league
- a recurring knockout
- a recurring championship

### 3. Season
A season is a year- or period-scoped instance of a broader series or tour.

Examples:
- Friends Tour 2026
- Majors 2027 Season
- Matchplay League 2025

A season groups together competitions and standings for a defined period.

### 4. Competition Instance
A competition instance is a playable event with fixed rules.

Examples:
- The Invitational 2026
- Summer Medal Round 3
- Society Championship 2025
- Matchplay Quarter Final 2026

Competition instances are immutable historical records once published/live/completed.

### 5. Event Identity Across Years
Recurring named events must have a persistent identity across seasons.

Example:
- Event template: `The Invitational`
- Competition instances:
  - `The Invitational 2025`
  - `The Invitational 2026`
  - `The Invitational 2027`

This allows event history pages and event-specific records to exist cleanly.

---

## Supported Competition Modes

### A. Standalone Competitions
Use for one-off events with no dependency on a broader season.

Examples:
- Saturday Medal
- One-day Stableford
- One-off matchplay challenge
- Charity day event

Must support:
- single-round stroke play
- multi-round stroke play
- stableford
- optional points awards
- optional handicap rules
- optional tee times
- optional public visibility later

### B. Multi-Round Stroke Play Competitions
Use for championships where total score spans multiple rounds.

Examples:
- Club Championship (36 holes / 54 holes / 72 holes)
- Weekend major over two rounds

Must support:
- fixed number of rounds
- round schedules
- leaderboard based on cumulative gross/net/stableford totals
- cut rules in future
- ties and playoff metadata
- round-by-round leaderboard and final leaderboard

### C. Matchplay League
Use for round-robin or fixture-based matchplay over a season.

Examples:
- society singles league
- winter matchplay ladder

Must support:
- participants list
- fixture generation or manual scheduling
- fixtures with home/away or neutral designation if needed
- points table / standings table
- wins, losses, halved matches
- optional divisions/groups
- season table and playoff phase later if needed

### D. Matchplay Knockout
Use for bracket-based elimination competition.

Examples:
- summer knockout cup
- annual major knockout

Must support:
- seeded or random bracket generation
- manual bracket creation
- rounds such as R16, QF, SF, Final
- match results and progression rules
- walkovers / withdrawals / byes
- historical bracket display

### E. Society / Friend-Group Tour
Use for a season-long schedule of events where points accumulate across competitions.

Examples:
- 10-event summer tour
- traveling friend group schedule

Must support:
- scheduled competitions
- season standings
- optional drops / best-N events
- tour history by year
- player career stats

### F. Major Series
Use for a recurring set of named events that repeat annually.

Examples:
- The Invitational
- The Masters
- The Open Weekend
- Closing Championship

Must support:
- event templates inside a named series
- annual instantiation
- history page for each recurring event
- all-time winners and records
- season-by-season summary

---

## Revised Taxonomy

The current model is flexible but too configuration-heavy. The revised model should prefer explicit presets and clearer domain types.

### Host Group Type
```ts
type HostGroupType =
  | "society"
  | "friend_group"
  | "tour"
  | "league"
  | "major_series_host"
  | "public_organizer"
  | "custom"
```

### Series Type
```ts
type SeriesType =
  | "tour"
  | "major_series"
  | "matchplay_league"
  | "matchplay_knockout"
  | "championship_series"
  | "season"
```

### Competition Format
```ts
type CompetitionFormat =
  | "stroke_play"
  | "stableford"
  | "matchplay_fixture"
  | "matchplay_knockout_match"
  | "aggregate_stroke_play"
  | "team_best_ball"
  | "team_scramble"
  | "custom"
```

### Competition Structure
```ts
type CompetitionStructure =
  | "standalone"
  | "multi_round"
  | "season_event"
  | "league_fixture"
  | "knockout_match"
```

### Scoring Basis
```ts
type ScoringBasis =
  | "gross"
  | "net"
  | "stableford_points"
  | "match_result"
```

### Standings Model
```ts
type StandingsModel =
  | "none"
  | "season_points"
  | "league_table"
  | "knockout_progression"
```

These enums should be validated through a compatibility matrix so invalid combinations cannot be created.

---

## Core Tables

## `host_groups`
Top-level containers for organizers, societies, tours, and friend groups.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `name` | text | Display name |
| `type` | enum | `society`, `friend_group`, `tour`, `league`, `major_series_host`, `public_organizer`, `custom` |
| `privacy` | enum | `private`, `request`, `invite_only`, `public` |
| `join_method` | enum | `open`, `request`, `invite_only`, `code` |
| `owner_profile_id` | uuid FK | Creator / primary admin |
| `max_members` | int? | Optional cap |
| `default_timezone` | text | Organizer timezone |
| `default_locale` | text? | |
| `branding` | jsonb | logo, colors, public details |
| `join_code` | text? | |
| `is_public_host` | boolean | For future public organizers |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

---

## `host_group_memberships`
Links users to groups.

| Column | Type | Description |
|--------|------|-------------|
| `group_id` | uuid FK | |
| `profile_id` | uuid FK | |
| `role` | enum | `owner`, `admin`, `member` |
| `status` | enum | `active`, `pending`, `invited`, `removed` |
| `joined_at` | timestamptz | |

Unique: `(group_id, profile_id)`

---

## `competition_series`
Reusable recurring structures owned by a group.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `group_id` | uuid FK | Parent host group |
| `name` | text | e.g. `Friends Majors` |
| `series_type` | enum | `tour`, `major_series`, `matchplay_league`, `matchplay_knockout`, `championship_series`, `season` |
| `description` | text? | |
| `recur_annually` | boolean | Default true |
| `default_start_month` | int? | |
| `default_end_month` | int? | |
| `is_active` | boolean | |
| `settings` | jsonb | low-risk display settings only |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

This is the top-level recurring structure.

---

## `series_seasons`
A season instance within a series.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `series_id` | uuid FK | Parent series |
| `season_year` | int | e.g. 2026 |
| `name` | text | e.g. `Friends Majors 2026` |
| `status` | enum | `draft`, `published`, `live`, `completed`, `archived` |
| `start_date` | date? | |
| `end_date` | date? | |
| `standings_model` | enum | `none`, `season_points`, `league_table`, `knockout_progression` |
| `standings_rules_version_id` | uuid FK? | Frozen standings rules |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

This is the entity used to view “the 2025 season as a whole”.

---

## `series_event_templates`
Named recurring events within a series.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `series_id` | uuid FK | Parent series |
| `name` | text | e.g. `The Invitational` |
| `slug` | text | Stable identifier across years |
| `sort_order` | int | Default order in series |
| `default_month` | int? | |
| `competition_format` | enum | Default format |
| `competition_structure` | enum | Default structure |
| `default_rules_template_id` | uuid FK? | |
| `is_active` | boolean | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

This creates continuity for event history across seasons.

---

## `competitions`
Playable competition instances.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `group_id` | uuid FK | Owning host group |
| `series_id` | uuid FK? | Parent series if applicable |
| `season_id` | uuid FK? | Parent season if applicable |
| `series_event_template_id` | uuid FK? | Recurring event identity |
| `name` | text | e.g. `The Invitational 2026` |
| `competition_format` | enum | `stroke_play`, `stableford`, `matchplay_fixture`, `matchplay_knockout_match`, etc. |
| `competition_structure` | enum | `standalone`, `multi_round`, `season_event`, `league_fixture`, `knockout_match` |
| `scoring_basis` | enum | `gross`, `net`, `stableford_points`, `match_result` |
| `num_rounds` | int | Default 1 |
| `status` | enum | `draft`, `published`, `entry_open`, `entry_closed`, `live`, `unofficial`, `official`, `completed`, `cancelled`, `archived` |
| `competition_date` | date? | Primary event date |
| `start_date` | date? | For multi-day competitions |
| `end_date` | date? | |
| `course_id` | uuid FK? | |
| `published_rules_version_id` | uuid FK | Frozen rules snapshot |
| `entry_window_start` | timestamptz? | |
| `entry_window_end` | timestamptz? | |
| `visibility` | enum | `private`, `group`, `public_discoverable` |
| `capacity` | int? | |
| `created_by_profile_id` | uuid FK | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Rules are never derived live from templates once a competition is published.

---

## `competition_rules_versions`
Frozen rules snapshots for competition instances.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `competition_id` | uuid FK? | Optional if attached directly |
| `source_template_id` | uuid FK? | Optional originating template |
| `rules_version` | int | |
| `competition_format` | enum | |
| `competition_structure` | enum | |
| `scoring_basis` | enum | |
| `handicap_config` | jsonb | frozen handicap rules |
| `points_config` | jsonb | season/placement points rules |
| `tie_break_config` | jsonb | tie logic |
| `eligibility_config` | jsonb | age, gender, membership, invite restrictions |
| `cut_config` | jsonb? | future multi-round support |
| `matchplay_config` | jsonb? | match length, allowance, playoff rules |
| `notes` | text? | admin note |
| `created_at` | timestamptz | |
| `created_by_profile_id` | uuid FK | |

This is critical for historical integrity.

---

## `competition_entries`
Entries into a competition.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `competition_id` | uuid FK | |
| `profile_id` | uuid FK | |
| `entry_status` | enum | `entered`, `pending_approval`, `approved`, `waitlisted`, `withdrawn`, `rejected`, `no_show` |
| `assigned_handicap_index` | numeric? | Snapshot at entry |
| `assigned_division_id` | uuid FK? | future flights/divisions |
| `seed` | int? | for knockout seeding |
| `team_id` | uuid FK? | future team formats |
| `entered_at` | timestamptz | |
| `updated_at` | timestamptz | |

Unique: `(competition_id, profile_id)`

---

## `competition_rounds`
Defines rounds within a multi-round competition.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `competition_id` | uuid FK | |
| `round_number` | int | 1..N |
| `name` | text | e.g. `Round 1`, `Final Round` |
| `scheduled_date` | date? | |
| `course_id` | uuid FK? | Optional round-specific course |
| `status` | enum | `scheduled`, `live`, `completed`, `cancelled` |
| `created_at` | timestamptz | |

Unique: `(competition_id, round_number)`

---

## `competition_round_submissions`
Round submissions for score-based competition.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `competition_id` | uuid FK | |
| `competition_round_id` | uuid FK | |
| `round_id` | uuid FK | Source played round |
| `profile_id` | uuid FK | |
| `submission_status` | enum | `pending`, `accepted`, `rejected`, `superseded`, `withdrawn`, `dq` |
| `gross_score` | int? | |
| `net_score` | int? | |
| `format_points` | numeric? | stableford etc |
| `course_handicap_used` | numeric? | |
| `submitted_at` | timestamptz | |
| `decided_at` | timestamptz? | |
| `decided_by_profile_id` | uuid FK? | |
| `decision_reason` | text? | |

Unique: `(competition_id, competition_round_id, profile_id, round_id)`

---

## `competition_leaderboard_entries`
Competition-level aggregated rankings for score-based formats.

| Column | Type | Description |
|--------|------|-------------|
| `competition_id` | uuid FK | |
| `profile_id` | uuid FK | |
| `ordinal_rank` | int | actual ranking order |
| `display_position` | int | displayed position with ties |
| `is_tied` | boolean | |
| `tie_group_size` | int | |
| `gross_total` | int? | |
| `net_total` | int? | |
| `format_points_total` | numeric? | |
| `points_earned` | numeric | standings points |
| `rounds_counted` | int | |
| `playoff_winner` | boolean | |
| `last_computed_at` | timestamptz | |

Unique: `(competition_id, profile_id)`

---

## `season_standings_entries`
Aggregated standings for season-based tours and series.

| Column | Type | Description |
|--------|------|-------------|
| `season_id` | uuid FK | |
| `profile_id` | uuid FK | |
| `position` | int | |
| `season_points` | numeric | |
| `events_played` | int | |
| `wins` | int | |
| `top_3s` | int | |
| `cuts_made` | int? | future |
| `best_finish` | int? | |
| `last_computed_at` | timestamptz | |

Unique: `(season_id, profile_id)`

---

## Matchplay-Specific Tables

Matchplay should be modeled explicitly instead of being squeezed into generic scoring tables.

## `matchplay_stages`
Stages within a matchplay competition.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `competition_id` | uuid FK | |
| `stage_type` | enum | `league_phase`, `group_phase`, `round_of_16`, `quarter_final`, `semi_final`, `final`, `placement`, `custom` |
| `name` | text | |
| `sort_order` | int | |
| `group_label` | text? | For divisions/groups |
| `created_at` | timestamptz | |

---

## `matchplay_fixtures`
Represents one match between two entrants.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `competition_id` | uuid FK | |
| `stage_id` | uuid FK? | |
| `round_number` | int? | |
| `home_entry_id` | uuid FK? | |
| `away_entry_id` | uuid FK? | |
| `scheduled_at` | timestamptz? | |
| `status` | enum | `scheduled`, `live`, `completed`, `walkover`, `cancelled` |
| `result_type` | enum | `home_win`, `away_win`, `halved`, `walkover_home`, `walkover_away`, `double_withdrawal` |
| `winning_entry_id` | uuid FK? | |
| `margin_holes` | int? | e.g. 3 |
| `holes_remaining` | int? | e.g. 2 in 3&2 |
| `extra_holes_played` | int? | |
| `approved_at` | timestamptz? | |
| `approved_by_profile_id` | uuid FK? | |
| `notes` | text? | |

---

## `matchplay_bracket_slots`
Tracks bracket structure and advancement for knockout competitions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `competition_id` | uuid FK | |
| `stage_id` | uuid FK | |
| `fixture_id` | uuid FK | |
| `slot_number` | int | 1 or 2 |
| `source_type` | enum | `entry`, `winner_of_fixture`, `loser_of_fixture`, `bye` |
| `source_entry_id` | uuid FK? | |
| `source_fixture_id` | uuid FK? | |

---

## `matchplay_league_table_entries`
Standings table for league-format matchplay.

| Column | Type | Description |
|--------|------|-------------|
| `competition_id` | uuid FK | |
| `stage_id` | uuid FK? | |
| `profile_id` | uuid FK | |
| `played` | int | |
| `won` | int | |
| `halved` | int | |
| `lost` | int | |
| `league_points` | numeric | |
| `matches_for` | int? | optional |
| `matches_against` | int? | optional |
| `position` | int | |
| `last_computed_at` | timestamptz | |

Unique: `(competition_id, stage_id, profile_id)`

---

## History & Stats Tables

## `event_history_summaries`
Precomputed yearly summary for a recurring event template.

| Column | Type | Description |
|--------|------|-------------|
| `series_event_template_id` | uuid FK | |
| `season_id` | uuid FK | |
| `competition_id` | uuid FK | |
| `season_year` | int | |
| `winner_profile_id` | uuid FK? | |
| `runner_up_profile_id` | uuid FK? | |
| `winning_score_summary` | text? | e.g. `-4`, `3&2` |
| `field_size` | int | |
| `completed_at` | timestamptz? | |

Unique: `(series_event_template_id, season_year)`

This supports pages like “The Invitational history”.

---

## `profile_competition_stats`
Cross-competition career stats per player.

| Column | Type | Description |
|--------|------|-------------|
| `profile_id` | uuid FK | |
| `group_id` | uuid FK? | optional scoped stats |
| `series_id` | uuid FK? | optional scoped stats |
| `wins` | int | |
| `runner_ups` | int | |
| `top_3s` | int | |
| `events_played` | int | |
| `stroke_play_wins` | int | |
| `matchplay_wins` | int | |
| `major_wins` | int | |
| `season_titles` | int | |
| `updated_at` | timestamptz | |

---

## `competition_audit_log`
Audit trail for trust and historical integrity.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `competition_id` | uuid FK | |
| `actor_profile_id` | uuid FK? | |
| `action_type` | enum | `created`, `published`, `entry_opened`, `entry_closed`, `rules_changed`, `submission_accepted`, `submission_rejected`, `leaderboard_recomputed`, `status_changed`, `fixture_result_updated` |
| `payload` | jsonb | |
| `created_at` | timestamptz | |

---

## Rules & Compatibility

The platform must stop relying on unlimited configuration combinations.

Instead, it should enforce a **format compatibility matrix**.

### Valid Presets

#### Score-Based Presets
- Stroke Play Gross (single round)
- Stroke Play Net (single round)
- Multi-Round Stroke Play Gross
- Multi-Round Stroke Play Net
- Stableford
- Multi-Round Stableford

#### Matchplay Presets
- Matchplay League
- Matchplay Group Stage + Knockout
- Matchplay Knockout
- One-off Matchplay Fixture

#### Season Presets
- Friend Tour Season
- Major Series Season
- Society Order of Merit

Each preset defines:
- supported number of rounds
- standings behavior
- allowed handicap config
- tie rules
- submission workflow
- whether fixtures or bracket structures are required

---

## Historical Continuity Requirements

This is a central product requirement.

### Event History
For a recurring event like **The Invitational**, the system must support:
- all years the event was held
- winners by year
- runner-up by year
- format used by year
- winning score/margin by year
- field size by year
- direct navigation to the full competition result page for each year

### Season History
For a season such as **Friends Majors 2025**, the system must support:
- complete season schedule
- standings table
- winners of each event
- season champion
- participant stats
- comparison against other years

### Player History
For a player profile, the system must support:
- all event appearances
- wins by format
- major wins
- season titles
- record in specific recurring events
- matchplay record
- stroke play scoring summaries

---

## Season Instantiation Model

The current series template system is directionally right, but should be expanded.

### For Major Series
When instantiating a season:
1. create a `series_seasons` row for the target year
2. create one `competitions` row per `series_event_template`
3. attach each competition to:
   - `series_id`
   - `season_id`
   - `series_event_template_id`
4. generate and freeze a `competition_rules_versions` record per competition
5. set initial statuses to `draft` or `published`

### For Matchplay League Seasons
Instantiation may also:
1. create the season
2. create the competition representing that league season
3. create fixtures automatically from entered participants or after entry close
4. compute league standings from fixture results

### For Knockout Seasons
Instantiation may also:
1. create the season
2. create the competition
3. generate bracket structure
4. seed participants manually or automatically

---

## Scoring & Computation

## Score-Based Competition Functions

### `compute_competition_leaderboard(competition_id)`
For stroke play / stableford / aggregate score formats:
- read accepted submissions
- aggregate round totals
- apply frozen handicap rules
- apply tie logic from rules version
- assign points earned if relevant
- update `competition_leaderboard_entries`
- emit audit log row

### `compute_season_standings(season_id)`
For season/tour standings:
- pull contributing completed competitions in season
- apply standings model
- apply drops / best-N if configured
- rank by season rules
- update `season_standings_entries`
- emit audit log row

## Matchplay Functions

### `compute_matchplay_league_table(competition_id)`
- read approved fixture results
- compute played/won/halved/lost
- apply league points rules
- apply tie-break ordering
- update `matchplay_league_table_entries`

### `advance_matchplay_bracket(competition_id)`
- detect completed fixtures
- populate next bracket slots
- mark progression
- update related future fixtures

---

## Permissions & Roles

### Group-Level Roles
| Role | Capabilities |
|------|-------------|
| `owner` | full control over group, seasons, competitions, roles |
| `admin` | manage competitions, entries, fixtures, results, standings |
| `member` | enter events, submit rounds, view private results |

### Future Organizer Roles
Public hosting may later add:
- `starter`
- `scorer`
- `event_manager`
- `viewer`

### Action Permissions
| Action | Required Role |
|--------|--------------|
| create series | `owner` or `admin` |
| instantiate season | `owner` or `admin` |
| publish competition | `owner` or `admin` |
| approve submissions | `owner`, `admin`, or elevated scorer role |
| update fixture result | `owner` or `admin` |
| recompute standings | `owner`, `admin`, or platform admin |
| create public event | `owner` or approved organizer |

---

## API Surface (Revised)

## Groups
- `GET /api/majors/groups`
- `POST /api/majors/groups`
- `GET /api/majors/groups/[id]`
- `PATCH /api/majors/groups/[id]`
- `POST /api/majors/groups/[id]/join`
- `GET /api/majors/groups/[id]/members`
- `POST /api/majors/groups/[id]/members`

## Series & Seasons
- `GET /api/majors/series`
- `POST /api/majors/series`
- `GET /api/majors/series/[id]`
- `POST /api/majors/series/[id]/events`
- `PATCH /api/majors/series/[id]/events/[eventId]`
- `POST /api/majors/series/[id]/instantiate-season`
- `GET /api/majors/series/[id]/history`
- `GET /api/majors/seasons/[id]`
- `GET /api/majors/seasons/[id]/standings`
- `POST /api/majors/seasons/[id]/recompute`

## Competitions
- `GET /api/majors/competitions`
- `POST /api/majors/competitions`
- `GET /api/majors/competitions/[id]`
- `PATCH /api/majors/competitions/[id]`
- `POST /api/majors/competitions/[id]/publish`
- `POST /api/majors/competitions/[id]/enter`
- `POST /api/majors/competitions/[id]/withdraw`
- `GET /api/majors/competitions/[id]/leaderboard`
- `POST /api/majors/competitions/[id]/leaderboard/recompute`

## Multi-Round
- `GET /api/majors/competitions/[id]/rounds`
- `POST /api/majors/competitions/[id]/rounds`
- `POST /api/majors/competitions/[id]/submit-round`

## Matchplay
- `GET /api/majors/competitions/[id]/fixtures`
- `POST /api/majors/competitions/[id]/fixtures/generate`
- `PATCH /api/majors/fixtures/[fixtureId]`
- `POST /api/majors/competitions/[id]/league-table/recompute`
- `POST /api/majors/competitions/[id]/bracket/advance`

## History & Profiles
- `GET /api/majors/events/[eventTemplateId]/history`
- `GET /api/majors/seasons/[id]/history`
- `GET /api/majors/profile`
- `GET /api/majors/profile/[profileId]`

---

## Core User Flows

### Flow 1: Create a Friend Tour
1. Create host group
2. Create series with `series_type = tour`
3. Create season for target year
4. Add competitions to season
5. Publish schedule
6. Compute season standings as events complete

### Flow 2: Create a Major Series
1. Create host group or use existing friend group
2. Create series with `series_type = major_series`
3. Add recurring event templates such as `The Invitational`
4. Instantiate 2026 season
5. Generate annual competition rows with frozen rules
6. Use event history pages to compare 2025 vs 2026 vs later years

### Flow 3: Run a Multi-Round Stroke Play Championship
1. Create competition with `competition_structure = multi_round`
2. Set `num_rounds > 1`
3. Create `competition_rounds`
4. Accept round submissions per round
5. Compute cumulative leaderboard
6. Mark final result official

### Flow 4: Run a Matchplay League
1. Create series or competition with `series_type = matchplay_league`
2. Enter participants
3. Generate fixtures or stage groups
4. Record fixture results
5. Compute league table
6. Display season standings and phase winners

### Flow 5: Run a Matchplay Knockout
1. Create competition or season with `series_type = matchplay_knockout`
2. Enter players
3. Seed bracket
4. Generate first-round fixtures
5. Record results and advance bracket
6. Preserve bracket in historical record

---

## UI / Page Requirements

### `/majors`
Dashboard showing:
- my upcoming competitions
- current seasons
- recent results
- current major series standings

### `/majors/groups/[id]`
Group page with tabs:
- competitions
- seasons
- members
- standings
- series
- history

### `/majors/series/[id]`
Series page with:
- overview
- event templates
- seasons
- all-time stats
- winners by year

### `/majors/seasons/[id]`
Season page with:
- schedule
- standings
- participants
- results
- season records

### `/majors/events/[eventTemplateId]`
Recurring event history page with:
- list of all years
- winners
- winning score/margin
- appearances
- direct links to each year’s competition

### `/majors/competitions/[id]`
Competition detail page with format-aware views:
- score leaderboard for stroke play
- rounds tab for multi-round
- fixtures/bracket for matchplay
- entries
- tee times
- audit/status panel for admins

### `/majors/profile/[id]`
Player profile page with:
- event history
- wins
- major wins
- season titles
- matchplay record
- stroke play performance

---

## Migration Strategy from Current Model

The existing model is a good base and should be evolved rather than replaced wholesale.

### Keep
- group concept
- competition concept
- series templates
- leaderboard precompute concept
- standings precompute concept
- role-based membership model

### Rename / Reshape
- `major_groups` → `host_groups`
- keep `competition_series`, but add real `series_type`
- add `series_seasons` as a first-class entity
- treat `series_event_templates` as recurring event identity
- replace loose `majors_status` with expanded competition lifecycle

### Add
- `competition_rules_versions`
- `competition_rounds`
- matchplay-specific tables
- richer `competition_entries`
- audit log
- event history summaries
- season-scoped standings keyed by season rather than only by group

### De-emphasize
- overly generic JSON-driven combinations without preset validation
- forcing matchplay into the same internal model as stroke play

---

## What This Revision Solves

This revised specification directly supports the ambitions for Majors:

- **Standalone competitions** are cleanly supported
- **Multi-round stroke play** is modeled explicitly with `competition_rounds`
- **Matchplay league** is supported through fixtures and league tables
- **Matchplay knockout** is supported through bracket slots and progression
- **Society and friend-group tours** are supported through `competition_series` + `series_seasons`
- **Major series** are supported through recurring event templates and yearly competition instances
- **Event history** is first-class through `series_event_template_id` and `event_history_summaries`
- **Season history** is first-class through `series_seasons` and `season_standings_entries`
- **Future public events** are supported through expanded visibility, entry, and organizer models

---

## Summary

Majors should evolve from a configurable competition feature into a structured golf competition platform with first-class support for:

- score-based competitions
- multi-round championships
- matchplay leagues
- matchplay knockouts
- friend-group tours
- annual major series
- event history and season history
- future public event hosting

The key architectural shift is to make **season history, recurring event identity, frozen rules, and format-specific competition modeling** explicit.

That will give the platform enough structure to remain understandable to users, reliable for admins, and durable over multiple years of competition history.
