"use client";

import React from "react";
import { Button } from "@/components/ui/button";

export default function ConfirmSheet(props: {
  title: string;
  subtitle?: React.ReactNode;
  confirmLabel: string;
  confirmDisabled?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const { title, subtitle, confirmLabel, confirmDisabled, onConfirm, onClose } = props;

  return (
    <div className="fixed inset-0 z-50">
      <button className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="Close" />
      <div className="absolute left-0 right-0 bottom-0 px-3 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-[520px] rounded-t-3xl border border-emerald-900/70 bg-[#061f12] shadow-2xl overflow-hidden">
          <div className="p-4 border-b border-emerald-900/60">
            <div className="text-sm font-semibold text-emerald-50">{title}</div>
            {subtitle ? <div className="text-[11px] text-emerald-100/70 mt-1">{subtitle}</div> : null}
          </div>

          <div className="p-4 flex gap-2">
            <Button
              variant="ghost"
              className="flex-1 rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/40 text-emerald-50 hover:bg-emerald-900/20"
              onClick={onClose}
              disabled={!!confirmDisabled}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 rounded-2xl bg-[#f5e6b0] text-[#042713] hover:bg-[#e9d79c] disabled:opacity-60"
              onClick={onConfirm}
              disabled={!!confirmDisabled}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
