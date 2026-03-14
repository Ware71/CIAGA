"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface BackButtonProps {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

export function BackButton({ onClick, disabled, className }: BackButtonProps) {
  const [navigating, setNavigating] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("px-2 text-emerald-100 hover:bg-emerald-900/30 shrink-0", className)}
      disabled={disabled || navigating}
      onClick={() => {
        setNavigating(true);
        onClick();
      }}
    >
      {navigating ? "…" : "← Back"}
    </Button>
  );
}
