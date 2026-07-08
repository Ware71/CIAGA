"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * NumberField — a controlled numeric input that keeps its display value as a
 * local *string* so intermediate edit states survive re-renders.
 *
 * Why this exists: a plain controlled `<input type="number">` whose React state
 * is a `number` re-coerces the text to a number on every keystroke. That makes
 * two states impossible to type:
 *   - clearing the field ("" → NaN → snaps back to a default), and
 *   - a trailing decimal ("72." → Number("72.") === 72 → the dot is erased).
 *
 * NumberField holds the raw string internally, only emits a parsed
 * `number | null` to the parent, and clamps/normalizes on blur.
 */
export type NumberFieldProps = {
  /** Current numeric value (source of truth in the parent). */
  value: number | null | undefined;
  /** Emitted when the field resolves to a number, or `null` when cleared (nullable only). */
  onValueChange: (v: number | null) => void;
  /** Allow a decimal point. Default: false (integers only). */
  allowDecimal?: boolean;
  /** Allow a leading minus sign. Default: false. */
  allowNegative?: boolean;
  /**
   * Whether the field may be left empty (emits `null`). Default: true.
   * When false, an empty field is tolerated *while editing* but on blur it is
   * restored to the last valid value (or `fallback`/`min`/0), and `null` is
   * never emitted.
   */
  nullable?: boolean;
  /** Value used on blur when a non-nullable field is empty and has no prior value. */
  fallback?: number;
  min?: number;
  max?: number;
  /** Select the field contents on focus so the user can type straight over it. Default: true. */
  selectOnFocus?: boolean;
  className?: string;
} & Omit<React.ComponentProps<"input">, "value" | "onChange" | "type">;

function toText(v: number | null | undefined): string {
  return v === null || v === undefined || Number.isNaN(v) ? "" : String(v);
}

function normalize(v: number | null | undefined): number | null {
  return v === null || v === undefined || Number.isNaN(v) ? null : v;
}

/** Partial states that are valid mid-edit but do not parse to a number. */
function isPartial(s: string): boolean {
  return s === "" || s === "-" || s === "." || s === "-.";
}

export function NumberField({
  value,
  onValueChange,
  allowDecimal = false,
  allowNegative = false,
  nullable = true,
  fallback,
  min,
  max,
  selectOnFocus = true,
  className,
  onFocus,
  onBlur,
  inputMode,
  ...rest
}: NumberFieldProps) {
  const [text, setText] = React.useState<string>(() => toText(value));

  // Reflect external value changes (e.g. a mode switch that sets a default)
  // without clobbering an in-progress edit: while typing, the parent value
  // becomes the same number we're showing, so parsed === incoming and we skip.
  React.useEffect(() => {
    const parsed = isPartial(text) ? null : Number(text);
    const current = parsed !== null && Number.isFinite(parsed) ? parsed : null;
    if (normalize(value) !== current) {
      setText(toText(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const pattern = React.useMemo(() => {
    const neg = allowNegative ? "-?" : "";
    const dec = allowDecimal ? "\\.?\\d*" : "";
    return new RegExp(`^${neg}\\d*${dec}$`);
  }, [allowDecimal, allowNegative]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw !== "" && !pattern.test(raw)) return; // reject disallowed characters
    setText(raw);
    if (isPartial(raw)) {
      if (nullable) onValueChange(null);
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) onValueChange(n);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (isPartial(text)) {
      if (nullable) {
        setText("");
        onValueChange(null);
      } else {
        const prior = normalize(value);
        const restore = prior ?? fallback ?? min ?? 0;
        setText(toText(restore));
        onValueChange(restore);
      }
    } else {
      let n = Number(text);
      if (Number.isFinite(n)) {
        if (min !== undefined) n = Math.max(min, n);
        if (max !== undefined) n = Math.min(max, n);
        setText(toText(n));
        onValueChange(n);
      }
    }
    onBlur?.(e);
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    if (selectOnFocus) e.target.select();
    onFocus?.(e);
  };

  return (
    <input
      {...rest}
      type="text"
      inputMode={inputMode ?? (allowDecimal ? "decimal" : "numeric")}
      value={text}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      className={cn(className)}
    />
  );
}
