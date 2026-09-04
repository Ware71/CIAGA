"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OddsFormatMenu } from "@/components/fantasy/OddsValue";
import { SeasonMarketsPanel, type SeasonBoard } from "@/components/fantasy/SeasonMarketsPanel";

export default function SeasonBoardClient({ seasonId }: { seasonId: string }) {
  const router = useRouter();
  const [board, setBoard] = useState<SeasonBoard | null>(null);

  return (
    <div className="min-h-[100dvh] max-w-sm mx-auto">
      <div className="px-4 pt-8 flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => router.push(board ? `/majors/fantasy/groups/${board.season.group_id}` : "/majors/fantasy")}
          className="text-[11px] text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text)]"
        >
          ← Group
        </button>
        <OddsFormatMenu />
      </div>

      <div className="px-4 mb-3">
        <h1 className="text-lg font-bold text-[color:var(--sec-accent)] leading-tight">
          {board?.season?.name ? `${board.season.name} · Season` : "Season Markets"}
        </h1>
        <div className="text-[10px] text-[color:var(--sec-muted)] mt-0.5">
          Priced from the remaining schedule · fair odds, simulated
        </div>
      </div>

      <div className="px-4 pb-8">
        <SeasonMarketsPanel seasonId={seasonId} onLoaded={setBoard} />
      </div>
    </div>
  );
}
