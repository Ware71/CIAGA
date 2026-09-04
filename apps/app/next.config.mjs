import withPWA from 'next-pwa';

const isProd = process.env.NODE_ENV === 'production';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // geolocation stays enabled for the nearby-courses feature
  { key: 'Permissions-Policy', value: 'camera=(), microphone=()' },
];

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Client Router Cache. `dynamic` defaults to 0, so before this every
    // navigation — including back/forward — re-ran the middleware auth hop,
    // getServerViewer and the page's queries even when the user had just been
    // there. 30s makes repeat navigation instant; the stale-while-revalidate
    // layer in lib/cache keeps what's on screen honest, and router.refresh()
    // is the escape hatch after a mutation.
    staleTimes: { dynamic: 30, static: 180 },
  },
  images: {
    // Avatars, group images and post images are Supabase Storage public URLs.
    // Without this, next/image refuses them and every one has to be a raw <img>.
    //
    // Nothing currently uses it: all ~45 Supabase images render as raw <img>.
    // That's a deliberate call rather than an oversight — the uploads are now
    // compressed to their display size and the service worker caches them
    // (see runtimeCaching below), so routing them through /_next/image would
    // spend a Vercel transformation quota to save nothing. Kept so the first
    // component that does want next/image works.
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' },
    ],
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

// Explicit runtime caching — do NOT fall back to next-pwa's defaults.
//
// The defaults cache every same-origin GET (including `/api/*` and HTML/RSC)
// NetworkFirst for 24h. Workbox keys its cache by URL only, and every app fetch
// authenticates via an `Authorization: Bearer` header, so an authenticated
// response cached for one user is served to the next user on the same device
// (sign out / sign in, or sandbox impersonation). The 24h window also means a
// flaky course connection can render day-old leaderboards, balances and odds as
// if they were live.
//
// Score entry — the only flow that genuinely needs to work offline — has its own
// localStorage op queue in app/round/[round_id]/RoundDetailClient.tsx, so the SW
// cache adds no capability here. Static assets only.
const runtimeCaching = [
  {
    urlPattern: /^https:\/\/fonts\.(?:gstatic)\.com\/.*/i,
    handler: 'CacheFirst',
    options: {
      cacheName: 'google-fonts-webfonts',
      expiration: { maxEntries: 4, maxAgeSeconds: 365 * 24 * 60 * 60 },
    },
  },
  {
    urlPattern: /^https:\/\/fonts\.(?:googleapis)\.com\/.*/i,
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: 'google-fonts-stylesheets',
      expiration: { maxEntries: 4, maxAgeSeconds: 7 * 24 * 60 * 60 },
    },
  },
  {
    urlPattern: /\.(?:eot|otf|ttc|ttf|woff|woff2|font.css)$/i,
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: 'static-font-assets',
      expiration: { maxEntries: 4, maxAgeSeconds: 7 * 24 * 60 * 60 },
    },
  },
  {
    urlPattern: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: 'static-image-assets',
      // 30d, not 24h: these are content-stable brand assets, and a 24h window
      // meant a user who opens the app daily kept re-fetching the splash logo.
      expiration: { maxEntries: 64, maxAgeSeconds: 30 * 24 * 60 * 60 },
    },
  },
  {
    urlPattern: /\/_next\/image\?url=.+$/i,
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: 'next-image',
      expiration: { maxEntries: 64, maxAgeSeconds: 24 * 60 * 60 },
    },
  },
  // Supabase Storage objects — avatars, group images, post photos.
  //
  // The anchoring is load-bearing, so do NOT "tidy" this into the tail-match
  // form of the image rule above. Workbox's RegExpRoute only accepts a
  // cross-origin match at index 0:
  //
  //   if (s && (e.origin === location.origin || 0 === s.index)) return …
  //
  // so `/\.(?:jpg|webp)$/i` matches the end of a Supabase URL, scores a non-zero
  // index, and is silently skipped. Every avatar therefore went to the network
  // on every render, which — with the same-origin NetworkOnly catch-all below —
  // meant the app had no image cache at all. That was most of a 6.5 GB
  // cached-egress month; see the 2026-09 audit.
  //
  // CacheFirst rather than SWR because these paths are immutable by
  // construction (`<uid>/<timestamp>.webp`, `<uid>/<uuid>.webp`): a cached copy
  // can never be stale, and a new upload is a new path. That makes a repeat
  // view of a screen full of avatars cost nothing.
  {
    urlPattern: /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/.*/i,
    handler: 'CacheFirst',
    options: {
      cacheName: 'supabase-storage',
      expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
      cacheableResponse: { statuses: [0, 200] },
    },
  },
  {
    urlPattern: /\/_next\/static\/.+$/i,
    handler: 'CacheFirst',
    options: {
      cacheName: 'next-static',
      expiration: { maxEntries: 128, maxAgeSeconds: 30 * 24 * 60 * 60 },
    },
  },
  {
    urlPattern: /\.(?:css|less)$/i,
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: 'static-style-assets',
      expiration: { maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 },
    },
  },
  // Everything else — API responses, HTML documents, RSC payloads — always goes
  // to the network. No stale auth-scoped data, no cross-user reuse.
  {
    urlPattern: ({ url }) => self.origin === url.origin,
    handler: 'NetworkOnly',
  },
];

export default withPWA({
  dest: 'public',
  disable: !isProd,  // PWA only in production
  // next-pwa's auto-register injects into the `main.js` entry, which the App
  // Router never loads — so we register /sw.js ourselves in
  // components/ServiceWorkerRegistrar.tsx instead. next-pwa still generates the
  // service worker + custom push worker.
  register: false,
  skipWaiting: true,
  runtimeCaching,
  // next-pwa otherwise prepends a NetworkFirst `start-url` route ahead of
  // everything above (dynamicStartUrl), and precaches `/` (cacheStartUrl).
  // `/` redirects to `/home`, which renders viewer-specific data — same
  // no-stale-auth-data rule as the rest. Both off; `/` falls through to
  // NetworkOnly like every other document.
  cacheStartUrl: false,
  dynamicStartUrl: false,
})(nextConfig);
