/* ============================================================
   MUSIQ PWA — pwa.js
   Service Worker registration, install prompt, monthly refresh,
   periodic background sync, offline handling
   ============================================================ */

// ─── SERVICE WORKER REGISTRATION ─────────────────────────────
let swRegistration = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      swRegistration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none', // always check for SW updates
      });
      console.log('[PWA] Service Worker registered:', swRegistration.scope);

      // Check for updates every time the page loads
      swRegistration.addEventListener('updatefound', () => {
        const newWorker = swRegistration.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast();
          }
        });
      });

      // Register for periodic background sync (Chrome Android)
      await registerPeriodicSync(swRegistration);

      // Register one-time background sync for next refresh
      await registerBackgroundSync(swRegistration);

      // Listen for messages from the service worker
      navigator.serviceWorker.addEventListener('message', handleSWMessage);

      // Check if fresh songs are already waiting from last SW refresh
      checkForFreshSongs();

    } catch (err) {
      console.warn('[PWA] Service Worker registration failed:', err);
    }
  });
}

// ─── PERIODIC BACKGROUND SYNC ────────────────────────────────
// Runs monthly even when the app is closed (Chrome Android only)
async function registerPeriodicSync(registration) {
  if (!('periodicSync' in registration)) {
    console.log('[PWA] Periodic Sync not supported on this browser');
    return;
  }
  try {
    const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (status.state === 'granted') {
      await registration.periodicSync.register('musiq-monthly-refresh', {
        minInterval: 30 * 24 * 60 * 60 * 1000, // 30 days in ms
      });
      console.log('[PWA] Periodic sync registered (30-day interval)');
    }
  } catch (err) {
    console.warn('[PWA] Periodic sync registration failed:', err.message);
  }
}

// ─── ONE-TIME BACKGROUND SYNC ─────────────────────────────────
async function registerBackgroundSync(registration) {
  if (!('sync' in registration)) return;
  try {
    const lastRefresh = localStorage.getItem('musiq_last_refresh');
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;

    if (!lastRefresh || (now - parseInt(lastRefresh)) > thirtyDays) {
      await registration.sync.register('monthly-refresh');
      console.log('[PWA] Background sync registered for monthly-refresh');
    }
  } catch (err) {
    console.warn('[PWA] Background sync failed:', err.message);
  }
}

// ─── HANDLE SW MESSAGES ───────────────────────────────────────
function handleSWMessage(event) {
  const { type, month, count } = event.data || {};
  if (type === 'MONTHLY_REFRESH_DONE') {
    console.log('[PWA] Monthly refresh done:', count, 'songs for', month);
    localStorage.setItem('musiq_last_refresh', Date.now().toString());
    showFreshBanner(count, month);
  }
}

// ─── FRESH SONGS BANNER ───────────────────────────────────────
function showFreshBanner(count, month) {
  const banner = document.getElementById('fresh-banner');
  const text   = document.getElementById('fresh-banner-text');
  if (!banner) return;
  if (text) {
    const [year, m] = (month || '').split('-');
    const monthName = m ? new Date(year, m - 1).toLocaleString('en-US', { month: 'long' }) : 'this month';
    text.textContent = `${count} fresh songs for ${monthName} ${year || ''} are ready!`;
  }
  banner.style.display = 'flex';
}

function checkForFreshSongs() {
  // Check if monthly songs are already cached from a previous SW refresh
  const freshRaw = localStorage.getItem('musiq_fresh_songs_pending');
  if (freshRaw) {
    try {
      const { songs, month } = JSON.parse(freshRaw);
      if (songs?.length) showFreshBanner(songs.length, month);
    } catch {}
  }
}

// Called when user taps "View now" on the fresh banner
function loadFreshSongs() {
  const banner = document.getElementById('fresh-banner');
  if (banner) banner.style.display = 'none';

  // Try to load from localStorage cache set by SW
  const freshRaw = localStorage.getItem('musiq_fresh_songs_pending');
  if (freshRaw) {
    try {
      const { songs } = JSON.parse(freshRaw);
      if (songs?.length) {
        allSongs = songs; // update the shared state in agent.js
        showView('search', document.querySelector('[data-view=search]'));
        renderSearchResults(songs);
        showStatus(`Loaded ${songs.length} freshly refreshed songs for this month`);
        document.getElementById('btn-export').style.display = 'inline-flex';
        localStorage.removeItem('musiq_fresh_songs_pending');
        return;
      }
    } catch {}
  }

  // Fallback: trigger a new fetch for recent songs
  autoSearch('', '', '2020s', 'Upbeat / Energetic');
}

// ─── PWA INSTALL PROMPT ───────────────────────────────────────
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;

  // Don't show if already dismissed
  if (localStorage.getItem('musiq_pwa_dismissed')) return;
  // Don't show if already installed
  if (window.matchMedia('(display-mode: standalone)').matches) return;

  // Show install banner after 3 seconds
  setTimeout(() => {
    document.getElementById('pwa-banner').style.display = 'flex';
  }, 3000);
});

document.getElementById('pwa-install-btn')?.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  console.log('[PWA] Install prompt outcome:', outcome);
  deferredInstallPrompt = null;
  document.getElementById('pwa-banner').style.display = 'none';
  if (outcome === 'accepted') {
    showToast('Musiq installed! Find it on your home screen.');
    localStorage.setItem('musiq_installed', '1');
  }
});

function dismissPWABanner() {
  document.getElementById('pwa-banner').style.display = 'none';
  localStorage.setItem('musiq_pwa_dismissed', '1');
}

// Track when app is installed
window.addEventListener('appinstalled', () => {
  console.log('[PWA] App installed successfully');
  deferredInstallPrompt = null;
  document.getElementById('pwa-banner').style.display = 'none';
  showToast('Musiq installed successfully!');
});

// ─── HANDLE URL PARAMS (shortcuts / deep links) ───────────────
(function handleURLParams() {
  const params = new URLSearchParams(window.location.search);
  const view   = params.get('view');
  const autoRefresh = params.get('autorefresh');

  if (view) {
    const navEl = document.querySelector(`[data-view="${view}"]`);
    if (navEl) showView(view, navEl);
  }

  if (autoRefresh === '1') {
    // Triggered from push notification — load fresh songs
    setTimeout(() => loadFreshSongs(), 500);
  }
})();

// ─── MANUAL MONTHLY REFRESH TRIGGER ──────────────────────────
// Called from Settings or admin — forces an immediate refresh
async function triggerManualRefresh() {
  showToast('Triggering monthly refresh…');
  try {
    const resp = await fetch('/api/cron-refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!resp.ok) throw new Error(`Server error ${resp.status}`);
    const data = await resp.json();
    if (data.songs?.length) {
      allSongs = data.songs;
      renderSearchResults(data.songs);
      showStatus(`Refreshed! Loaded ${data.songs.length} songs for ${data.month}`);
      document.getElementById('btn-export').style.display = 'inline-flex';
      localStorage.setItem('musiq_last_refresh', Date.now().toString());
      showToast(`${data.songs.length} fresh songs loaded`);
    }
  } catch (err) {
    showToast('Refresh failed: ' + err.message);
  }
}

// ─── UPDATE TOAST ─────────────────────────────────────────────
function showUpdateToast() {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerHTML = 'New version available — <button onclick="window.location.reload()" style="background:none;border:none;color:#6c63ff;cursor:pointer;font-weight:600;padding:0;margin-left:4px;">Refresh</button>';
  t.classList.add('show');
  // Don't auto-hide this one — user needs to act
}

// ─── OFFLINE INDICATOR ───────────────────────────────────────
window.addEventListener('online',  () => showToast('Back online'));
window.addEventListener('offline', () => showToast('You are offline — cached content available'));
