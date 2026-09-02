// src/components/stats/Modal.tsx
"use client";

import React from "react";

export function Modal({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <button aria-label="Close" className="absolute inset-0 bg-black/55" onClick={onClose} type="button" />
      <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2">
        <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:var(--ciaga-ground)] shadow-2xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--sec-hair)]">
            <div className="text-sm font-extrabold text-[color:var(--sec-accent)]">{title}</div>
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] font-bold text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text)]"
            >
              Done
            </button>
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
