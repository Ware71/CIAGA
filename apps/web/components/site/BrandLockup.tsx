import Image from "next/image";
import Link from "next/link";

/**
 * The CIAGA / EST. 2025 wordmark. Mirrors the header lockup in
 * apps/app/app/home/HomeClient.tsx so the two products read as one brand.
 */
export function BrandLockup({
  size = "md",
  href,
  subtitle = true,
  priority = false,
}: {
  size?: "sm" | "md";
  href?: string;
  subtitle?: boolean;
  priority?: boolean;
}) {
  const px = size === "sm" ? 32 : 40;

  const inner = (
    <>
      <div
        className={`${
          size === "sm" ? "h-8 w-8" : "h-10 w-10"
        } grid shrink-0 place-items-center rounded-full border border-[#0a341c]/40 bg-[#0a341c]/70 backdrop-blur-sm`}
      >
        <Image
          src="/ciaga-logo-96.png"
          // Decorative: the word "CIAGA" sits right next to it, so alt text
          // here would make a screen reader announce the brand twice.
          alt=""
          width={px}
          height={px}
          priority={priority}
          className="rounded-full object-contain"
        />
      </div>
      <div className="flex flex-col leading-tight">
        <span
          className={`${
            size === "sm" ? "text-base" : "text-lg"
          } font-semibold tracking-wide text-[#f5e6b0]`}
        >
          CIAGA
        </span>
        {subtitle ? (
          <span className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/80">
            Est. 2025
          </span>
        ) : null}
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="flex items-center gap-3">
        {inner}
      </Link>
    );
  }

  return <div className="flex items-center gap-3">{inner}</div>;
}
