import withPWA from 'next-pwa';

const isProd = process.env.NODE_ENV === 'production';

const nextConfig = {
  reactStrictMode: true,
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
