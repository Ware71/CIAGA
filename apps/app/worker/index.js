/* eslint-disable no-restricted-globals */
// Custom service-worker logic injected into the next-pwa generated worker.
// next-pwa compiles this file (worker/index.js) into public/worker-*.js and
// imports it from the generated sw.js. It handles Web Push delivery + clicks.
//
// NOTE: PWA / service worker is only registered in production builds
// (see next.config.mjs `disable: !isProd`). Push cannot be tested in `next dev`.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = { title: "CIAGA", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "CIAGA Golf";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || "/home" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/home";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing window if one is open, navigating it to the target.
        for (const client of clientList) {
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client) {
              try {
                client.navigate(url);
              } catch (_e) {
                /* navigation may be cross-origin / unsupported; ignore */
              }
            }
            return;
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      })
  );
});
