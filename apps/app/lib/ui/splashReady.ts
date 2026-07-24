// Readiness signal for the cold-start splash (components/ui/SplashHost.tsx).
//
// The splash lives in the root layout so its DOM node survives the /home
// Suspense swap, which means it can't read HomeClient's state directly. This
// module is the one-way channel: HomeClient calls markSplashReady() once the
// essential player info is on screen (from cache or from the streamed core
// promise) and the splash plays its exit.
//
// Late subscribers are called immediately if the signal already fired, so a
// subscriber that mounts after markSplashReady() can't miss it.

let ready = false;
const subscribers = new Set<() => void>();

export function markSplashReady(): void {
  if (ready) return;
  ready = true;
  for (const cb of subscribers) cb();
  subscribers.clear();
}

export function subscribeSplashReady(cb: () => void): () => void {
  if (ready) {
    cb();
    return () => {};
  }
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function isSplashReady(): boolean {
  return ready;
}
