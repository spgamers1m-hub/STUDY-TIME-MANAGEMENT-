/* =========================================
   STUDY TIME — SERVICE WORKER
   PWA + Offline Shell + Push Notifications
========================================= */

const CACHE_NAME = "study-time-shell-v1";

const APP_FILES = [
  "./",
  "./index.html"
];

/* INSTALL */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .catch(() => {})
  );

  self.skipWaiting();
});

/* ACTIVATE */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key =>
            key.startsWith("study-time-") &&
            key !== CACHE_NAME
          )
          .map(key => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

/* OFFLINE PAGE SUPPORT */
self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        return await caches.match("./index.html");
      })
    );
  }
});

/* PUSH NOTIFICATIONS */
self.addEventListener("push", (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = {
      title: "STUDY TIME",
      body: event.data
        ? event.data.text()
        : "You have a new notification."
    };
  }

  const title = data.title || "STUDY TIME";

  const options = {
    body: data.body || "You have a new update.",
    tag: data.tag || "study-time-notification",
    data: {
      url: data.url || "./"
    },
    vibrate: [200, 100, 200]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

/* NOTIFICATION CLICK */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(
    event.notification.data?.url || "./",
    self.location.origin
  ).href;

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then(windows => {
      for (const client of windows) {
        if (client.url === targetUrl && "focus" in client) {
          return client.focus();
        }
      }

      return clients.openWindow(targetUrl);
    })
  );
});