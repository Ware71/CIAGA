"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type InviteErrorCode =
  | "invalid_invite_id"
  | "invite_not_found"
  | "invite_inactive"
  | "already_claimed"
  | "rate_limited"
  | "server_error";

function messageForError(code: InviteErrorCode) {
  switch (code) {
    case "already_claimed":
      return "This invite has already been claimed.";
    case "invite_not_found":
    case "invite_inactive":
      return "Invite link is no longer active.";
    case "invalid_invite_id":
      return "This invite link is invalid.";
    case "rate_limited":
      return "Please wait a moment, then try again.";
    default:
      return "We could not process this invite right now.";
  }
}

export default function InviteStartPage() {
  return (
    <Suspense>
      <InviteStartPageContent />
    </Suspense>
  );
}

function InviteStartPageContent() {
  const searchParams = useSearchParams();
  const inviteId = useMemo(() => String(searchParams.get("invite_id") ?? "").trim(), [searchParams]);

  const [working, setWorking] = useState(false);
  const [resending, setResending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [lastErrorCode, setLastErrorCode] = useState<InviteErrorCode | null>(null);

  useEffect(() => {
    if (!inviteId) {
      setLastErrorCode("invalid_invite_id");
      setMsg(messageForError("invalid_invite_id"));
      setIsError(true);
      return;
    }
    if (lastErrorCode === "invalid_invite_id") {
      setLastErrorCode(null);
      setMsg(null);
      setIsError(false);
    }
  }, [inviteId, lastErrorCode]);

  const canResend = lastErrorCode === "invite_inactive";

  async function handleContinue() {
    if (!inviteId) {
      setLastErrorCode("invalid_invite_id");
      setMsg(messageForError("invalid_invite_id"));
      setIsError(true);
      return;
    }

    setMsg(null);
    setIsError(false);
    setWorking(true);

    try {
      const res = await fetch("/api/invites/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite_id: inviteId }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const code: InviteErrorCode = (json?.error as InviteErrorCode) || "server_error";
        setLastErrorCode(code);
        setMsg(messageForError(code));
        setIsError(true);
        return;
      }

      const actionLink = String(json?.action_link ?? "").trim();
      if (!actionLink) {
        setLastErrorCode("server_error");
        setMsg(messageForError("server_error"));
        setIsError(true);
        return;
      }

      window.location.assign(actionLink);
    } catch {
      setLastErrorCode("server_error");
      setMsg(messageForError("server_error"));
      setIsError(true);
    } finally {
      setWorking(false);
    }
  }

  async function handleResend() {
    if (!inviteId) {
      setLastErrorCode("invalid_invite_id");
      setMsg(messageForError("invalid_invite_id"));
      setIsError(true);
      return;
    }

    setMsg(null);
    setIsError(false);
    setResending(true);

    try {
      const res = await fetch("/api/invites/request-new-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite_id: inviteId }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const code: InviteErrorCode = (json?.error as InviteErrorCode) || "server_error";
        setLastErrorCode(code);
        setMsg(messageForError(code));
        setIsError(true);
        return;
      }

      setLastErrorCode(null);
      setMsg("A fresh invite link has been sent.");
      setIsError(false);
    } catch {
      setLastErrorCode("server_error");
      setMsg(messageForError("server_error"));
      setIsError(true);
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8">
      <div className="mx-auto w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold text-[#f5e6b0]">Finish your invite</h1>

        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/90 space-y-2">
          <p>Click continue to securely verify your invite and finish account setup.</p>
          <p className="text-emerald-200/60">This extra step helps prevent email scanners from using one-time links.</p>
        </div>

        {msg && (
          <div
            className={[
              "rounded-2xl border p-3 text-sm",
              isError
                ? "border-red-900/40 bg-red-950/20 text-red-200"
                : "border-emerald-900/70 bg-[#0b3b21]/70 text-emerald-100/90",
            ].join(" ")}
          >
            {msg}
          </div>
        )}

        <div className="space-y-2">
          <button
            onClick={handleContinue}
            disabled={working || resending || !inviteId}
            className="w-full rounded-xl bg-emerald-700/80 hover:bg-emerald-700 px-4 py-3 text-sm font-medium disabled:opacity-50"
          >
            {working ? "Continuing..." : "Continue"}
          </button>

          {canResend && (
            <button
              onClick={handleResend}
              disabled={working || resending}
              className="w-full rounded-xl border border-emerald-900/70 bg-[#0b3b21]/70 hover:bg-[#0b3b21] px-4 py-3 text-sm font-medium text-emerald-100/80 disabled:opacity-50"
            >
              {resending ? "Sending..." : "Send me a new invite link"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
