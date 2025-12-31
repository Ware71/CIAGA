"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function RoundPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="px-2 text-emerald-100 hover:bg-emerald-900/30"
            onClick={() => router.back()}
          >
            ← Back
          </Button>

          <div className="text-center flex-1">
            <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">
              Round
            </div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
              Coming soon
            </div>
          </div>

          <div className="w-[60px]" />
        </header>

        {/* Body */}
        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-6 text-center space-y-3">
          <div className="text-sm font-semibold text-emerald-50">
            Round tracking not live yet
          </div>

          <p className="text-[11px] text-emerald-100/70 leading-relaxed">
            This page will handle live scoring, hole-by-hole input,
            tee selection, and stats.
          </p>

          <div className="pt-2 text-[10px] text-emerald-100/50">
            CIAGA · Round Engine v1
          </div>
        </div>
      </div>
    </div>
  );
}
