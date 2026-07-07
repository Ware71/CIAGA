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
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default withPWA({
  dest: 'public',
  disable: !isProd,  // PWA only in production
  // next-pwa's auto-register injects into the `main.js` entry, which the App
  // Router never loads — so we register /sw.js ourselves in
  // components/ServiceWorkerRegistrar.tsx instead. next-pwa still generates the
  // service worker + custom push worker.
  register: false,
  skipWaiting: true,
})(nextConfig);
