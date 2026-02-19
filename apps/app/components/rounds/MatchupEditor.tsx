// components/rounds/MatchupEditor.tsx
"use client";

import { useMemo } from "react";

type MatchupParticipant = {
  id: string;
  displayName: string;
};

type MatchupTeam = {
  id: string;
  name: string;
};

type Matchup = {
  player_a_id: string;
  player_b_id: string;
};

type TeamMatchup = {
  team_a_id: string;
  team_b_id: string;
};

type MatchupEditorProps = {
  mode: "individual" | "team";
  participants?: MatchupParticipant[];
  teams?: MatchupTeam[];
  matchups: Matchup[] | TeamMatchup[];
  roundRobin?: boolean;
  onChange: (matchups: Matchup[] | TeamMatchup[], roundRobin: boolean) => void;
  disabled?: boolean;
};

function generateRoundRobin(ids: string[]): Matchup[] {
  const pairs: Matchup[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      pairs.push({ player_a_id: ids[i], player_b_id: ids[j] });
    }
  }
  return pairs;
}

function generateTeamRoundRobin(ids: string[]): TeamMatchup[] {
  const pairs: TeamMatchup[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      pairs.push({ team_a_id: ids[i], team_b_id: ids[j] });
    }
  }
  return pairs;
}

export function MatchupEditor({
  mode,
  participants = [],
  teams = [],
  matchups,
  roundRobin = false,
  onChange,
  disabled,
}: MatchupEditorProps) {
  const items = mode === "individual" ? participants : teams;

  // Auto-pair when exactly 2 items
  const isAutoPaired = items.length === 2;

  const autoMatchups = useMemo(() => {
    if (!isAutoPaired) return null;
    if (mode === "individual") {
      return [{ player_a_id: items[0].id, player_b_id: items[1].id }] as Matchup[];
    }
    return [{ team_a_id: items[0].id, team_b_id: items[1].id }] as TeamMatchup[];
  }, [isAutoPaired, mode, items]);

  const displayMatchups = isAutoPaired ? autoMatchups : matchups;

  const nameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (mode === "individual") {
      for (const p of participants) map.set(p.id, p.displayName);
    } else {
      for (const t of teams) map.set(t.id, t.name);
    }
    return map;
  }, [mode, participants, teams]);

  function handleRoundRobinToggle(enabled: boolean) {
    if (enabled) {
      if (mode === "individual") {
        onChange(generateRoundRobin(participants.map((p) => p.id)), true);
      } else {
        onChange(generateTeamRoundRobin(teams.map((t) => t.id)), true);
      }
    } else {
      onChange([], false);
    }
  }

  if (items.length < 2) {
    return (
      <div className="text-[11px] text-emerald-100/60">
        {mode === "individual"
          ? "Add at least 2 players to configure matchups."
          : "Create at least 2 teams to configure matchups."}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {isAutoPaired ? (
        <div className="text-[11px] text-emerald-100/70">
          Auto-paired: {nameMap.get(items[0].id)} vs {nameMap.get(items[1].id)}
        </div>
      ) : (
        <>
          {/* Round robin toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={roundRobin}
              onChange={(e) => handleRoundRobinToggle(e.target.checked)}
              disabled={disabled}
              className="rounded border-emerald-700 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50"
            />
            <label className="text-xs text-emerald-100">
              Round robin (everyone plays each other)
            </label>
          </div>
        </>
      )}

      {/* Display matchups */}
      {displayMatchups && displayMatchups.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] text-emerald-100/50 uppercase tracking-wider">Matchups</div>
          {displayMatchups.map((m, i) => {
            const aId = "player_a_id" in m ? m.player_a_id : (m as TeamMatchup).team_a_id;
            const bId = "player_b_id" in m ? m.player_b_id : (m as TeamMatchup).team_b_id;
            return (
              <div
                key={i}
                className="flex items-center gap-2 rounded-lg border border-emerald-900/50 bg-[#042713]/50 px-3 py-2 text-xs text-emerald-100"
              >
                <span className="font-medium">{nameMap.get(aId) ?? "?"}</span>
                <span className="text-emerald-100/50">vs</span>
                <span className="font-medium">{nameMap.get(bId) ?? "?"}</span>
              </div>
            );
          })}
        </div>
      )}

      {!isAutoPaired && !roundRobin && (!displayMatchups || displayMatchups.length === 0) && (
        <div className="text-[11px] text-emerald-100/60">
          Enable round robin or configure matchups above.
        </div>
      )}
    </div>
  );
}
