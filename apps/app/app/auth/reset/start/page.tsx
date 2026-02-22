"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function ResetStartPage() {
  return (
    <Suspense>
      <ResetStartPageContent />
    </Suspense>
  );
}

function ResetStartPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const tokenHash = searchParams.get("token_hash") ?? "";
  const type = searchParams.get("type") ?? "";

  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tokenHash || type !== "recovery") {
      setError("This reset link is invalid. Please request a new one.");
    }
  }, [tokenHash, type]);

  async function handleContinue() {
    if (!tokenHash || type !== "recovery") return;

    setError(null);
    setWorking(true);

    try {
      const { error: otpErr } = await supabase.auth.verifyOtp({
        type: "recovery",
        token_hash: tokenHash,
      });

      if (otpErr) {
        setError("This reset link has expired or was already used.");
        return;
      }

      router.replace("/auth?recovery=true");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setWorking(false);
    }
  }

  const isInvalid = !tokenHash || type !== "recovery";

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8">
      <div className="mx-auto w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold text-[#f5e6b0]">Reset your password</h1>

        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/90 space-y-2">
          <p>Click continue to verify your reset link and choose a new password.</p>
          <p className="text-emerald-200/60">This extra step helps prevent email scanners from using one-time links.</p>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-900/40 bg-red-950/20 p-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <button
            onClick={handleContinue}
            disabled={working || isInvalid}
            className="w-full rounded-xl bg-emerald-700/80 hover:bg-emerald-700 px-4 py-3 text-sm font-medium disabled:opacity-50"
          >
            {working ? "Verifying..." : "Continue"}
          </button>

          {(error || isInvalid) && (
            <button
              onClick={() => router.replace("/auth?error=recovery_expired")}
              className="w-full rounded-xl border border-emerald-900/70 bg-[#0b3b21]/70 hover:bg-[#0b3b21] px-4 py-3 text-sm font-medium text-emerald-100/80"
            >
              Request a new reset link
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
