# 🎵 Musiq — AI Music Agent  v5.0

Full-featured music discovery PWA with:
- 📱 Phone number login + OTP verification
- 👤 User profiles (name, email, DOB, country, genres)
- 🔒 600 searches/day per user — popup warning when limit reached
- 🔄 Monthly auto-refresh via Vercel cron
- 💚 Spotify links + MusicBrainz + Analytics + Favourites
- 🤖 Powered by Google Gemini (FREE, 1500 req/day)

---

## Step 1 — Get your Google Gemini API key (FREE)

1. Go to https://aistudio.google.com
2. Sign in with Google
3. Click "Get API Key" → "Create API key"
4. Copy it (starts with AIzaSy...)

---

## Step 2 — Set up Firebase (FREE)

Firebase handles OTP SMS, user profiles, and daily usage tracking.
Free Spark plan: 10,000 OTPs/month, 1GB Firestore storage.

### 2a. Create Firebase project
1. Go to https://console.firebase.google.com
2. Click "Add project" → name it "musiq-agent" → Continue
3. Disable Google Analytics (optional) → Create project

### 2b. Enable Phone Authentication
1. In Firebase Console → Authentication → Get started
2. Sign-in providers → Phone → Enable → Save

### 2c. Create Firestore Database
1. Firebase Console → Firestore Database → Create database
2. Choose "Start in production mode" → select your region → Done
3. Go to Rules tab → paste contents of firestore.rules → Publish

### 2d. Get Firebase web config
1. Firebase Console → Project Settings (gear icon) → Your apps
2. Click "</>" (Web) → Register app → name it "musiq-web"
3. Copy the firebaseConfig object — you need all 6 values

### 2e. Add config to your app
Open js/auth.js and replace the FIREBASE_CONFIG values:
```js
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSy-your-firebase-key",
  authDomain:        "musiq-agent-xxx.firebaseapp.com",
  projectId:         "musiq-agent-xxx",
  storageBucket:     "musiq-agent-xxx.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123:web:abc123",
};
```

### 2f. Add your domain to Firebase Auth
1. Firebase Console → Authentication → Settings → Authorized domains
2. Add your Vercel domain: your-app.vercel.app
3. Also add: localhost (for local testing)

---

## Step 3 — Deploy to Vercel

```bash
git init && git add . && git commit -m "Musiq v5"
# Push to GitHub, then import on vercel.com
```

In Vercel → Project Settings → Environment Variables, add:
- GEMINI_API_KEY = AIzaSy-your-gemini-key
- ALLOWED_ORIGIN = https://your-app.vercel.app
- CRON_SECRET = any-random-string

---

## Step 4 — Test locally

```bash
cp .env.example .env.local
# Add your GEMINI_API_KEY

# Option A: open index.html directly in browser
# Then go to Settings → paste your Gemini key

# Option B: run with vercel dev
npm install && vercel dev
```

---

## Daily limit system

| Detail | Value |
|---|---|
| Searches per user per day | 600 |
| Resets at | Midnight (local time) |
| Tracked in | Firestore + localStorage |
| Warning | Full-screen popup modal |
| Limit config | Change DAILY_LIMIT in js/auth.js |

To change the daily limit, edit line in js/auth.js:
```js
const DAILY_LIMIT = 600; // change this number
```

---

## File structure

```
musiq-agent/
├── index.html              ← Full app + auth screens + limit modal
├── manifest.json           ← PWA manifest
├── sw.js                   ← Service Worker
├── firestore.rules         ← Firestore security rules
├── css/style.css           ← All styles including auth + profile
├── js/
│   ├── auth.js             ← Firebase auth, OTP, profile, daily limit
│   ├── agent.js            ← Music search (Gemini), charts, favourites
│   └── pwa.js              ← SW registration, install prompt
├── api/
│   ├── chat.js             ← Gemini proxy (secure)
│   └── cron-refresh.js     ← Monthly auto-refresh
├── vercel.json             ← Vercel config + cron schedule
├── .env.example            ← Environment variables template
└── README.md
```

---

## Security

- API keys never in browser — all in Vercel env vars
- Firestore rules: users can only access their own data
- OTP verified by Firebase — not bypassable
- reCAPTCHA invisible — prevents OTP spam/abuse
- Daily limit tracked server-side in Firestore
- CORS locked to your domain in production

---

## Free tier limits

| Service | Free limit |
|---|---|
| Gemini API | 1,500 req/day |
| Firebase OTP SMS | 10,000/month |
| Firestore reads | 50,000/day |
| Firestore writes | 20,000/day |
| Vercel hosting | 100GB bandwidth/month |
| Vercel functions | 100,000 invocations/month |

All free — no credit card needed.
