/* ============================================================
   MUSIQ SERVICE WORKER — sw.js
   Handles: offline caching, background data refresh,
   push notifications for monthly fresh data
   ============================================================ */

const CACHE_NAME      = 'musiq-v3';
const DATA_CACHE_NAME = 'musiq-data-v3';

// Static assets to cache on install (app shell)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/agent.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Clash+Display:wght@400;500;600;700&family=Satoshi:wght@300;400;500;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
];

// ─── INSTALL: cache app shell ─────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing Musiq Service Worker v3');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache what we can, skip failures (e.g. external fonts in strict CSP)
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE: clean old caches ───────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating Musiq Service Worker v3');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== DATA_CACHE_NAME)
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ─── FETCH: network-first for API, cache-first for assets ─────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never intercept API calls — always go network
  if (url.pathname.startsWith('/api/')) {
    return; // Let the browser handle it normally
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        // Only cache successful GET responses from our own origin
        if (
          response.ok &&
          event.request.method === 'GET' &&
          (url.origin === self.location.origin || url.hostname.includes('fonts') || url.hostname.includes('cloudflare'))
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback — return cached index.html for navigation
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// ─── BACKGROUND SYNC: monthly fresh data refresh ──────────────
// Triggered by the app registering a sync tag 'monthly-refresh'
self.addEventListener('sync', event => {
  if (event.tag === 'monthly-refresh') {
    console.log('[SW] Background sync: monthly-refresh triggered');
    event.waitUntil(doMonthlyRefresh());
  }
});

// ─── PERIODIC BACKGROUND SYNC (Chrome Android) ────────────────
// Runs automatically once per period even when app is closed
self.addEventListener('periodicsync', event => {
  if (event.tag === 'musiq-monthly-refresh') {
    console.log('[SW] Periodic sync: musiq-monthly-refresh');
    event.waitUntil(doMonthlyRefresh());
  }
});

// ─── PUSH NOTIFICATIONS ───────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  const title   = data.title   || 'Musiq — Fresh Music Ready';
  const options = {
    body:    data.body    || 'New trending songs for this month have been loaded!',
    icon:    '/icons/icon-192.png',
    badge:   '/icons/icon-96.png',
    tag:     'musiq-refresh',
    renotify: true,
    actions: [
      { action: 'view',    title: 'View new songs' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
    data: { url: '/?view=search&autorefresh=1' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ─── MONTHLY REFRESH LOGIC ────────────────────────────────────
async function doMonthlyRefresh() {
  try {
    const now       = new Date();
    const monthKey  = `${now.getFullYear()}-${now.getMonth() + 1}`;
    const lastKey   = await getStored('last_refresh_month');

    if (lastKey === monthKey) {
      console.log('[SW] Already refreshed this month, skipping');
      return;
    }

    console.log('[SW] Running monthly refresh for', monthKey);

    // Build the monthly trending prompt
    const month = now.toLocaleString('en-US', { month: 'long' });
    const year  = now.getFullYear();

    const prompt = `You are a music data expert. Return 20 trending and notable songs released or that went viral in ${month} ${year}, or the most recent month if that's in the future. Mix genres and languages — include global hits from USA, UK, India, South Korea, Nigeria, Latin America, and others. Follow these rules:
1. Only real songs that exist
2. Prioritise songs released or charting in ${month} ${year}
3. Include a diverse mix: Pop, Hip-Hop, Bollywood, K-Pop, Afrobeats, Latin
4. Return ONLY a valid JSON array, no markdown, no explanation

Each object: { "title": string, "artist": string, "year": number, "genre": string, "language": string, "mood": string, "album": string, "country": string, "bpm": number, "notable_fact": string, "musicbrainz_id": string, "spotify_search": string }`;

    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!resp.ok) throw new Error(`API error ${resp.status}`);

    const data = await resp.json();
    const raw  = data.content?.find(b => b.type === 'text')?.text || '';
    const clean = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/,'').trim();
    const songs = JSON.parse(clean);

    if (!Array.isArray(songs) || songs.length === 0) throw new Error('Empty response');

    // Store fresh songs and update timestamp
    await setStored('monthly_fresh_songs', JSON.stringify(songs));
    await setStored('last_refresh_month', monthKey);
    await setStored('last_refresh_time', now.toISOString());

    console.log('[SW] Monthly refresh complete —', songs.length, 'songs cached');

    // Notify all open clients that fresh data is ready
    const clientList = await clients.matchAll({ type: 'window' });
    clientList.forEach(client => {
      client.postMessage({
        type: 'MONTHLY_REFRESH_DONE',
        month: monthKey,
        count: songs.length,
      });
    });

    // Show push notification if supported
    if (self.registration.showNotification) {
      await self.registration.showNotification('Musiq — Fresh Music Ready 🎵', {
        body: `${songs.length} new trending songs for ${month} ${year} have been loaded!`,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-96.png',
        tag: 'musiq-refresh',
      });
    }

  } catch (err) {
    console.error('[SW] Monthly refresh failed:', err);
  }
}

// ─── SIMPLE KEY-VALUE STORE (IndexedDB-free, uses Cache API) ──
async function setStored(key, value) {
  const cache = await caches.open('musiq-kv');
  const resp  = new Response(value, { headers: { 'Content-Type': 'text/plain' } });
  await cache.put(`/kv/${key}`, resp);
}

async function getStored(key) {
  const cache  = await caches.open('musiq-kv');
  const stored = await cache.match(`/kv/${key}`);
  return stored ? stored.text() : null;
}
