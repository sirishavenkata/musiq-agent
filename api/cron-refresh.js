/**
 * api/cron-refresh.js — Musiq Agent v4
 * Monthly cron job using Google Gemini 1.5 Flash (free)
 * Runs: 1st of every month at 06:00 UTC (configured in vercel.json)
 */

let memoryCache = { songs: [], month: '', refreshed: '' };

export default async function handler(req, res) {
  // ── Auth ──────────────────────────────────────────────────
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const cronSecret   = process.env.CRON_SECRET;
  if (cronSecret && !isVercelCron) {
    if (req.headers.authorization !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  // ── Status check ──────────────────────────────────────────
  if (req.method === 'GET' && req.query.action === 'status') {
    return res.status(200).json({
      last_refresh: memoryCache.refreshed || null,
      month:        memoryCache.month     || null,
      song_count:   memoryCache.songs?.length || 0,
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

  const now      = new Date();
  const month    = now.toLocaleString('en-US', { month: 'long' });
  const year     = now.getFullYear();
  const monthKey = `${year}-${now.getMonth() + 1}`;

  console.log(`[cron] Monthly refresh for ${month} ${year}`);

  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const geminiCall = async (prompt) => {
    const r = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      }),
    });
    const d = await r.json();
    return d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  };

  const prompts = [
    `Return a JSON array of 20 real trending global pop, hip-hop, R&B, electronic songs from ${month} ${year} or most recent month. Mix English, Spanish, French. Each object: {"title":string,"artist":string,"year":number,"genre":string,"language":string,"mood":string,"album":string,"country":string,"bpm":number,"notable_fact":string,"musicbrainz_id":string,"spotify_search":string}`,
    `Return a JSON array of 15 real trending songs from India (Bollywood, Punjabi, Tamil, Telugu) and East Asia (K-Pop, J-Pop) from ${month} ${year} or most recent. Each object: {"title":string,"artist":string,"year":number,"genre":string,"language":string,"mood":string,"album":string,"country":string,"bpm":number,"notable_fact":string,"musicbrainz_id":string,"spotify_search":string}`,
    `Return a JSON array of 15 real trending songs from Africa (Afrobeats, Amapiano), Latin America (Reggaeton), Middle East from ${month} ${year} or most recent. Each object: {"title":string,"artist":string,"year":number,"genre":string,"language":string,"mood":string,"album":string,"country":string,"bpm":number,"notable_fact":string,"musicbrainz_id":string,"spotify_search":string}`,
  ];

  try {
    const results = await Promise.allSettled(prompts.map(p => geminiCall(p)));

    let allSongs = [];
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      try {
        const clean = r.value.replace(/^```json\s*/i,'').replace(/```\s*$/,'').trim();
        const songs = JSON.parse(clean);
        if (Array.isArray(songs)) allSongs = allSongs.concat(songs);
      } catch {}
    }

    // Deduplicate
    const seen = new Set();
    allSongs = allSongs.filter(s => {
      const k = `${s.title}||${s.artist}`.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k); return true;
    }).map(s => ({
      title:          String(s.title          || ''),
      artist:         String(s.artist         || ''),
      year:           Number(s.year)           || year,
      genre:          String(s.genre          || ''),
      language:       String(s.language       || ''),
      mood:           String(s.mood           || ''),
      album:          String(s.album          || ''),
      country:        String(s.country        || ''),
      bpm:            Number(s.bpm)            || 0,
      notable_fact:   String(s.notable_fact   || ''),
      musicbrainz_id: String(s.musicbrainz_id || ''),
      spotify_search: String(s.spotify_search || s.title + ' ' + s.artist),
      fresh: true,
      refreshed_month: monthKey,
    })).filter(s => s.title && s.artist);

    memoryCache = { songs: allSongs, month: monthKey, refreshed: now.toISOString() };

    console.log(`[cron] Refresh done — ${allSongs.length} songs`);

    return res.status(200).json({
      success:    true,
      month:      monthKey,
      song_count: allSongs.length,
      refreshed:  now.toISOString(),
      songs:      allSongs,
    });

  } catch (err) {
    console.error('[cron] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}