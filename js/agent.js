/* ============================================================
   MUSIQ AGENT — agent.js  v2.0
   Calls /api/chat (Vercel serverless proxy) — API key never
   exposed in the browser. Works locally via `vercel dev`.
   ============================================================ */

// ─── CONFIG ──────────────────────────────────────────────────
const API_ENDPOINT = '/api/chat';

// ─── STATE ───────────────────────────────────────────────────
let allSongs        = [];
let favourites      = JSON.parse(localStorage.getItem('musiq_favs') || '[]');
let activeChartType = 'genre';
let currentView     = 'home';

const GRADIENTS = [
  ['#6c63ff','#a855f7'],['#f093fb','#f5576c'],['#4facfe','#00f2fe'],
  ['#43e97b','#38f9d7'],['#fa709a','#fee140'],['#ff6b35','#f7931e'],
  ['#667eea','#764ba2'],['#1DB954','#00d4aa'],['#f7971e','#ffd200'],
  ['#ee0979','#ff6a00'],
];

const CHART_COLORS = [
  '#6c63ff','#00d4aa','#ff6b9d','#ffa500','#4facfe',
  '#43e97b','#fa709a','#667eea','#f7971e','#1DB954',
];

// ─── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  renderFavourites();
  refreshRecentSection();
});

// ─── NAVIGATION ───────────────────────────────────────────────
function showView(name, el) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const view = document.getElementById('view-' + name);
  if (view) view.classList.add('active');
  if (el) el.classList.add('active');
  currentView = name;
  if (name === 'charts') renderChart(activeChartType);
  if (name === 'library') renderFavourites();
  document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ─── SETTINGS ─────────────────────────────────────────────────
function showSettings() {
  document.getElementById('settings-modal').classList.add('open');
  const saved = localStorage.getItem('musiq_api_key') || '';
  document.getElementById('api-key-input').value = saved;
}

function closeSettings(e) {
  if (!e || e.target === document.getElementById('settings-modal')) {
    document.getElementById('settings-modal').classList.remove('open');
  }
}

function saveSettings() {
  const key = document.getElementById('api-key-input').value.trim();
  if (key) localStorage.setItem('musiq_api_key', key);
  else localStorage.removeItem('musiq_api_key');
  document.getElementById('settings-modal').classList.remove('open');
  showToast('Settings saved');
}

function loadSettings() {
  const key = localStorage.getItem('musiq_api_key');
  if (key && document.getElementById('api-key-input')) {
    document.getElementById('api-key-input').value = key;
  }
}

function getApiKey() {
  return localStorage.getItem('musiq_api_key') || '';
}

// ─── PROMPT BUILDER ───────────────────────────────────────────
function buildPrompt(genre, language, era, mood, count, country, custom) {
  const filters = [
    genre    && `Genre: ${genre}`,
    language && `Primary language of lyrics: ${language}`,
    era      && `Release decade: ${era}`,
    mood     && `Mood / energy: ${mood}`,
    country  && `Country of origin: ${country}`,
    custom   && `Additional requirement: ${custom}`,
  ].filter(Boolean).join('\n');

  return `You are a music data expert with deep encyclopedic knowledge of global recorded music from 1980 to 2025.

Task: Return exactly ${count} REAL songs that match ALL of these criteria:
${filters || 'No specific filters — return a diverse, high-quality mix across genres, languages, eras, and countries from 1980 to 2025.'}

STRICT ACCURACY RULES:
1. Every song MUST actually exist — no invented or hallucinated songs.
2. Artist name must be exactly correct (e.g. "The Weeknd" not "Weeknd").
3. Year must be the original single or album release year.
4. Album must be the correct original album the song appeared on.
5. BPM must be a realistic integer — never 0 or null.
6. Language must be the actual language sung (e.g. Hindi not Indian).
7. Country must be the artist home country (e.g. South Korea for BTS).
8. musicbrainz_id: include the real MBID only if 100% certain, else return empty string.
9. spotify_search: use format "Song Title Artist Name" for best Spotify search results.
10. notable_fact: one true, specific, verifiable fact — chart position, award, cultural impact.

Return ONLY a valid JSON array. No markdown, no backticks, no explanation.

Each object must have exactly these keys:
{
  "title": string,
  "artist": string,
  "year": number,
  "genre": string,
  "language": string,
  "mood": string,
  "album": string,
  "country": string,
  "bpm": number,
  "notable_fact": string,
  "musicbrainz_id": string,
  "spotify_search": string
}`;
}

// ─── API CALL (Google Gemini) ────────────────────────────────
async function callAgent(prompt) {
  // Always try the server proxy first (/api/chat)
  // This works on Vercel production — the GEMINI_API_KEY is stored server-side
  try {
    const proxyResp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });

    if (proxyResp.ok) {
      const data = await proxyResp.json();
      return data;
    }

    // Proxy returned an error — get the message
    const proxyErr = await proxyResp.json().catch(() => ({}));

    // 404 or 405 means no server (local dev without vercel dev)
    // Fall through to direct Gemini call
    if (proxyResp.status === 404 || proxyResp.status === 405) {
      console.log('[agent] Proxy not available, trying direct Gemini call');
    } else {
      // Real server error — throw it
      throw new Error(proxyErr.error || `Server error ${proxyResp.status}`);
    }
  } catch (fetchErr) {
    // Only continue to fallback if it is a network error (no server running)
    const isNetworkError = fetchErr.message && (
      fetchErr.message.includes('Failed to fetch') ||
      fetchErr.message.includes('NetworkError') ||
      fetchErr.message.includes('fetch')
    );
    if (!isNetworkError) throw fetchErr;
    console.log('[agent] Network error reaching proxy, trying direct call');
  }

  // Fallback: direct Gemini call (local dev only)
  // Uses API key saved in Settings
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      'No server proxy found and no API key configured.\n' +
      'For deployed app: Add GEMINI_API_KEY in Vercel → Project Settings → Environment Variables.\n' +
      'For local testing: Open Settings (sidebar) and paste your Google Gemini API key.'
    );
  }

  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const resp = await fetch(GEMINI_URL, {
    method: 'POST',
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
      },
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini API error ${resp.status}`);
  }

  const d = await resp.json();
  return { text: d?.candidates?.[0]?.content?.parts?.[0]?.text || '' };
}

// ─── FETCH SONGS ──────────────────────────────────────────────
async function fetchSongs() {
  const genre    = document.getElementById('f-genre').value;
  const language = document.getElementById('f-language').value;
  const era      = document.getElementById('f-era').value;
  const mood     = document.getElementById('f-mood').value;
  const country  = document.getElementById('f-country').value;
  const count    = document.getElementById('f-count').value;
  const custom   = document.getElementById('f-custom').value.trim();

  // Check daily limit before proceeding
  if (typeof checkDailyLimit === 'function' && !checkDailyLimit()) return;

  setLoading(true, 'Asking the music agent…');

  try {
    const data = await callAgent(buildPrompt(genre, language, era, mood, count, country, custom));

    // Gemini proxy returns { text } directly
    const raw = data.text || '';

    let songs;
    try {
      const clean = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/,'').trim();
      songs = JSON.parse(clean);
    } catch {
      console.error('Raw response:', raw);
      throw new Error('Agent returned unexpected format. Please try again.');
    }

    if (!Array.isArray(songs) || songs.length === 0) {
      throw new Error('No songs returned. Try adjusting your filters.');
    }

    // Sanitise to ensure UI never breaks
    songs = songs.map(s => ({
      title:          String(s.title          || 'Unknown Title'),
      artist:         String(s.artist         || 'Unknown Artist'),
      year:           Number(s.year)           || 2000,
      genre:          String(s.genre          || 'Unknown'),
      language:       String(s.language       || 'Unknown'),
      mood:           String(s.mood           || ''),
      album:          String(s.album          || ''),
      country:        String(s.country        || ''),
      bpm:            Number(s.bpm)            || 0,
      notable_fact:   String(s.notable_fact   || ''),
      musicbrainz_id: String(s.musicbrainz_id || ''),
      spotify_search: String(s.spotify_search || s.title + ' ' + s.artist),
    }));

    allSongs = songs;
    // Increment daily usage counter
    if (typeof incrementUsage === 'function') incrementUsage();
    setLoading(false);
    showStatus(`Found ${songs.length} song${songs.length > 1 ? 's' : ''} · Spotify & MusicBrainz links ready`);
    document.getElementById('btn-export').style.display = 'inline-flex';
    renderSearchResults(songs);
    localStorage.setItem('musiq_recent', JSON.stringify(songs.slice(0, 6)));
    refreshRecentSection();

  } catch (err) {
    setLoading(false);
    showError(err.message);
  }
}

// ─── QUICK SEARCHES ───────────────────────────────────────────
function autoSearch(genre, language, era, mood) {
  showView('search', document.querySelector('[data-view=search]'));
  setTimeout(() => {
    document.getElementById('f-genre').value    = genre    || '';
    document.getElementById('f-language').value = language || '';
    document.getElementById('f-era').value      = era      || '';
    document.getElementById('f-mood').value     = mood     || '';
    document.getElementById('f-country').value  = '';
    document.getElementById('f-custom').value   = '';
    fetchSongs();
  }, 120);
}

function quickGenre(g) { autoSearch(g, '', '', ''); }

function randomDiscover() {
  const g = ['K-Pop','Afrobeats','Latin / Reggaeton','Bollywood / Filmi','Electronic / EDM','Jazz','Hip-Hop / Rap','R&B / Soul','Reggae / Dancehall'];
  const l = ['Korean','Swahili','Spanish','Hindi','Japanese','French','Portuguese','English','Arabic','Tamil'];
  const e = ['1980s','1990s','2000s','2010s','2020s'];
  const m = ['Upbeat / Energetic','Melancholic / Sad','Romantic','Chill / Relaxed','Party / Dance','Rebellious'];
  document.getElementById('f-genre').value    = g[Math.floor(Math.random()*g.length)];
  document.getElementById('f-language').value = l[Math.floor(Math.random()*l.length)];
  document.getElementById('f-era').value      = e[Math.floor(Math.random()*e.length)];
  document.getElementById('f-mood').value     = m[Math.floor(Math.random()*m.length)];
  document.getElementById('f-country').value  = '';
  document.getElementById('f-custom').value   = '';
  fetchSongs();
}

// ─── RENDER ───────────────────────────────────────────────────
function renderSearchResults(songs) {
  document.getElementById('search-results').innerHTML = songs.map((s,i) => songCardHTML(s,i)).join('');
}

function songCardHTML(s, i) {
  const grad    = GRADIENTS[i % GRADIENTS.length];
  const decade  = Math.floor(s.year / 10) * 10 + 's';
  const hasMBID = s.musicbrainz_id && s.musicbrainz_id.length > 10;
  const spotifyURL = `https://open.spotify.com/search/${encodeURIComponent(s.spotify_search || s.title + ' ' + s.artist)}`;
  const mbURL = hasMBID
    ? `https://musicbrainz.org/recording/${s.musicbrainz_id}`
    : `https://musicbrainz.org/search?query=${encodeURIComponent(s.title + ' ' + s.artist)}&type=recording`;
  const isSaved  = isFavourite(s);
  const favClass = isSaved ? 'btn-fav active' : 'btn-fav';
  const favIcon  = isSaved ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
  const songData = encodeURIComponent(JSON.stringify(s));

  return `
    <div class="song-card">
      <div class="song-num">
        <div class="song-num-bg" style="background:linear-gradient(135deg,${grad[0]},${grad[1]});"></div>
        <span>${i + 1}</span>
      </div>
      <div class="song-info">
        <div class="song-title">${escHTML(s.title)}${hasMBID ? ' <span class="mb-badge">✓ MB</span>' : ''}</div>
        <div class="song-artist">${escHTML(s.artist)} · ${s.year}${s.album ? ' · ' + escHTML(s.album) : ''}</div>
        <div class="song-tags">
          <span class="tag tag-genre">${escHTML(s.genre)}</span>
          <span class="tag tag-lang">${escHTML(s.language)}</span>
          <span class="tag tag-era">${decade}</span>
          ${s.mood    ? `<span class="tag tag-mood">${escHTML(s.mood)}</span>` : ''}
          ${s.country ? `<span class="tag tag-country">${escHTML(s.country)}</span>` : ''}
          ${s.bpm     ? `<span class="tag tag-bpm">~${s.bpm} BPM</span>` : ''}
        </div>
        ${s.notable_fact ? `<div class="song-fact">${escHTML(s.notable_fact)}</div>` : ''}
      </div>
      <div class="song-actions">
        <div class="action-links">
          <a class="link-btn link-spotify" href="${spotifyURL}" target="_blank" rel="noopener">
            <i class="fa-brands fa-spotify"></i> Spotify
          </a>
          <a class="link-btn link-mb" href="${mbURL}" target="_blank" rel="noopener">
            <i class="fa-solid fa-database"></i> MB
          </a>
        </div>
        <button class="${favClass}" onclick="toggleFav(decodeURIComponent('${songData}'))">
          <i class="${favIcon}"></i>
        </button>
      </div>
    </div>`;
}

// ─── FAVOURITES ───────────────────────────────────────────────
function isFavourite(song) {
  return favourites.some(f => f.title === song.title && f.artist === song.artist);
}

function toggleFav(songJSON) {
  let song;
  try { song = typeof songJSON === 'string' ? JSON.parse(songJSON) : songJSON; } catch { return; }
  const idx = favourites.findIndex(f => f.title === song.title && f.artist === song.artist);
  if (idx >= 0) { favourites.splice(idx, 1); showToast('Removed from favourites'); }
  else { favourites.push(song); showToast('♥ Added to favourites'); }
  localStorage.setItem('musiq_favs', JSON.stringify(favourites));
  if (allSongs.length) renderSearchResults(allSongs);
  if (currentView === 'library') renderFavourites();
}

function renderFavourites() {
  const list = document.getElementById('fav-list');
  const empty = document.getElementById('fav-empty');
  const acts  = document.getElementById('fav-actions');
  if (!favourites.length) {
    list.innerHTML = ''; empty.style.display = 'block'; acts.style.display = 'none'; return;
  }
  empty.style.display = 'none'; acts.style.display = 'flex';
  list.innerHTML = favourites.map((s,i) => songCardHTML(s,i)).join('');
}

function clearFavourites() {
  if (!confirm('Clear all favourites? This cannot be undone.')) return;
  favourites = []; localStorage.removeItem('musiq_favs');
  renderFavourites(); showToast('Favourites cleared');
}

function exportFavCSV() { if (favourites.length) downloadCSV(favourites, 'musiq_favourites.csv'); }

// ─── RECENT ───────────────────────────────────────────────────
function refreshRecentSection() {
  const recent  = JSON.parse(localStorage.getItem('musiq_recent') || '[]');
  const section = document.getElementById('recent-section');
  const list    = document.getElementById('recent-list');
  if (!recent.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  list.innerHTML = recent.map((s,i) => songCardHTML(s,i)).join('');
}

// ─── CHARTS ───────────────────────────────────────────────────
function setChart(type, el) {
  document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  activeChartType = type; renderChart(type);
}

function renderChart(type) {
  const wrap = document.getElementById('chart-container');
  if (!allSongs.length) {
    wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-chart-simple"></i><p>No data yet</p><span>Run a search first</span></div>`;
    return;
  }
  let counts = {};
  if (type === 'bpm') {
    counts = {'< 80':0,'80–99':0,'100–119':0,'120–139':0,'140–159':0,'160+':0};
    allSongs.forEach(s => {
      const b = Number(s.bpm)||0;
      if(b<80) counts['< 80']++; else if(b<100) counts['80–99']++;
      else if(b<120) counts['100–119']++; else if(b<140) counts['120–139']++;
      else if(b<160) counts['140–159']++; else counts['160+']++;
    });
  } else {
    allSongs.forEach(s => {
      const val = type==='era' ? Math.floor(s.year/10)*10+'s' : (s[type]||'Unknown');
      counts[val] = (counts[val]||0)+1;
    });
  }
  const sorted = Object.entries(counts).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  const max = sorted[0]?.[1]||1;
  const titles = {genre:'Songs by genre',language:'Songs by language',era:'Songs by decade',mood:'Songs by mood',country:'Songs by country',bpm:'BPM distribution'};
  wrap.innerHTML = `
    <div class="chart-inner-title">${titles[type]} <span style="font-size:12px;font-weight:400;color:var(--text-muted);">(${allSongs.length} songs)</span></div>
    <div class="bar-chart">
      ${sorted.map(([label,val],i) => `
        <div class="bar-row">
          <div class="bar-label" title="${escHTML(label)}">${escHTML(label)}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${Math.round((val/max)*100)}%;background:${CHART_COLORS[i%CHART_COLORS.length]};"></div>
          </div>
          <div class="bar-count">${val}</div>
        </div>`).join('')}
    </div>`;
}

// ─── CSV ──────────────────────────────────────────────────────
function exportCSV() { if (allSongs.length) downloadCSV(allSongs, 'musiq_results.csv'); }

function downloadCSV(songs, filename) {
  const headers = ['Title','Artist','Year','Genre','Language','Mood','Album','Country','BPM','MusicBrainz ID','Spotify Search','Notable Fact'];
  const rows = songs.map(s =>
    [s.title,s.artist,s.year,s.genre,s.language,s.mood,s.album,s.country,s.bpm,
     s.musicbrainz_id||'',s.spotify_search||'',s.notable_fact||'']
      .map(v=>`"${String(v??'').replace(/"/g,'""')}"`)
      .join(','));
  const blob = new Blob([[headers.join(','),...rows].join('\n')],{type:'text/csv;charset=utf-8;'});
  const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(blob),download:filename});
  a.click(); showToast(`Downloaded ${filename}`);
}

// ─── HELPERS ──────────────────────────────────────────────────
function setLoading(on, msg) {
  const state = document.getElementById('loading-state');
  const btn   = document.getElementById('btn-search');
  if (state) state.style.display = on ? 'flex' : 'none';
  if (btn)   btn.disabled = on;
  if (on) {
    document.getElementById('search-results').innerHTML = '';
    document.getElementById('btn-export').style.display = 'none';
    document.getElementById('results-status').style.display = 'none';
    if (msg) document.getElementById('loading-text').textContent = msg;
  }
}

function showStatus(msg) {
  const el = document.getElementById('results-status');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function showError(msg) {
  const el = document.getElementById('search-results');
  if (!el) return;
  el.innerHTML = `<div style="color:#ff7070;font-size:14px;padding:1.5rem;background:rgba(255,80,80,0.08);border:1px solid rgba(255,80,80,0.2);border-radius:12px;line-height:1.8;">
    <i class="fa-solid fa-circle-exclamation" style="margin-right:8px;"></i>
    ${msg.split('\n').map(l=>`<div>${escHTML(l)}</div>`).join('')}
  </div>`;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function escHTML(str) {
  return String(str??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement?.id === 'f-custom') fetchSongs();
  if (e.key === 'Escape') { closeSettings(); document.getElementById('sidebar').classList.remove('open'); }
});