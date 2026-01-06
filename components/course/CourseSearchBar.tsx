"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CourseSearchBar(props: {
  value: string;
  onChange: (v: string) => void;
  onSearch: () => void;

  loading?: boolean;
  disabled?: boolean;

  placeholder?: string;
  className?: string;

  showClear?: boolean;
  onClear?: () => void;
}) {
  const {
    value,
    onChange,
    onSearch,
    loading = false,
    disabled = false,
    placeholder = "Search for a course…",
    className = "",
    showClear = false,
    onClear,
  } = props;

  const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Enter") onSearch();
  };

  return (
    <div className={`flex gap-2 ${className}`}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
      />

      {showClear && (
        <Button
          type="button"
          variant="outline"
          onClick={onClear}
          disabled={disabled || loading || !value.trim()}
        >
          Clear
        </Button>
      )}

      <Button
        type="button"
        onClick={onSearch}
        disabled={disabled || loading || !value.trim()}
      >
        {loading ? "Searching…" : "Search"}
      </Button>
    </div>
  );
}
