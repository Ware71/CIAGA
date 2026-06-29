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

  const tasks = [self.registration.showNotification(title, options)];

  // Set the installed-PWA app-icon badge to the recipient's unread count.
  // Supported on iOS 16.4+ home-screen apps and Android/desktop Chrome; the
  // foreground hook keeps it in sync and clears it once everything is read.
  if (typeof data.badgeCount === "number" && self.navigator && "setAppBadge" in self.navigator) {
    tasks.push(
      data.badgeCount > 0
        ? self.navigator.setAppBadge(data.badgeCount).catch(() => {})
        : self.navigator.clearAppBadge().catch(() => {})
    );
  }

  event.waitUntil(Promise.all(tasks));
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
