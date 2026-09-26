import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

// Only versioned application assets and icons are injected by Vite.
// No HTML/navigation fallback, API, Access login, identity or schedule caching.
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
// Future Web Push handlers belong here once user/subscription storage exists.
