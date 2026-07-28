import { Eyebrow } from "./Section";

export function PillRow({
  label,
  items,
  tone = "default",
}: {
  label?: string;
  items: readonly string[];
  tone?: "default" | "muted";
}) {
  return (
    <div>
      {label ? <Eyebrow>{label}</Eyebrow> : null}
      <div className={`flex flex-wrap gap-2 ${label ? "mt-3" : ""}`}>
        {items.map((item) => (
          <span
            key={item}
            className={
              tone === "muted"
                ? "rounded-full border border-emerald-900/60 bg-[#042713]/60 px-3 py-1 text-xs font-medium text-emerald-100/75"
                : "rounded-full border border-emerald-700/50 bg-emerald-950/40 px-3 py-1 text-xs font-semibold text-[#f5e6b0]"
            }
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
