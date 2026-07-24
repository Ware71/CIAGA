/**
 * Fallback for route segments without their own loading.tsx.
 *
 * Deliberately plain: the branded cold-start animation lives in
 * components/ui/SplashHost.tsx (mounted from the root layout, above this), so
 * rendering a logo here would put a second copy on screen — which is what made
 * the splash jitter in the first place.
 */
export default function Loading() {
  return <div aria-hidden className="fixed inset-0 z-[9999] bg-[#042713]" />;
}
