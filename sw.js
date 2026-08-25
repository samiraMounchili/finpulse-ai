/* ==========================================================================
   FinPulse AI — Progressive Web App (PWA) ServiceWorker
   ========================================================================== */

const CACHE_NAME = 'finpulse-ai-v3';
const ASSETS_TO_CACHE = [
    './',
    './style.css',
    './app.js',
    './manifest.json',
    './animated_architecture.svg'
];

// Install Event — Cache Core App Shell & Offline Engine
self.addEventListener('install', (event) => {
    console.log('⚡ [ServiceWorker] Installing FinPulse AI PWA Cache...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('✅ [ServiceWorker] Pre-caching App Shell & HMRC Engine...');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

// Activate Event — Clean up stale caches
self.addEventListener('activate', (event) => {
    console.log('⚡ [ServiceWorker] Activating FinPulse AI PWA...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        console.log('🧹 [ServiceWorker] Removing stale cache:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch Event — Network-First with Cache Fallback for Offline Stage Readiness
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                // If response is valid, update cache clone
                if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            })
            .catch(() => {
                // Fallback to cache if network is offline during stage presentation
                console.warn('⚠️ [ServiceWorker] Network offline. Serving asset from cache:', event.request.url);
                return caches.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    if (event.request.headers.get('accept').includes('text/html')) {
                        return caches.match('./');
                    }
                });
            })
    );
});
