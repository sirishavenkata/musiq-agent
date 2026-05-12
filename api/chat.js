/**
 * api/chat.js — Musiq Agent v4
 * Secure proxy using Google Gemini 1.5 Flash (FREE, no credit card)
 * GEMINI_API_KEY is stored in Vercel env vars — never exposed to browser
 */

export default async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin',  process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // ── Validate key ──────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY not set. Add it in Vercel → Project Settings → Environment Variables.'
    });
  }

  // ── Parse body ────────────────────────────────────────────
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { prompt } = body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  // ── Call Gemini 1.5 Flash ─────────────────────────────────
  // Model: gemini-1.5-flash-8b — free tier, 1500 req/day, fast & accurate
  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-8b-8b:generateContent?key=${apiKey}`;

  try {
    const geminiResp = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature:     0.7,
          topK:            40,
          topP:            0.95,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json', // force JSON output
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      }),
    });

    const data = await geminiResp.json();

    if (!geminiResp.ok) {
      console.error('Gemini API error:', data);
      return res.status(geminiResp.status).json({
        error: data?.error?.message || 'Gemini API error'
      });
    }

    // Extract text from Gemini response format
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) {
      return res.status(500).json({ error: 'Empty response from Gemini' });
    }

    return res.status(200).json({ text });

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Failed to reach Gemini API: ' + err.message });
  }
}