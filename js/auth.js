/* ============================================================
   MUSIQ AUTH — auth.js  v5.0
   Firebase Phone Auth · OTP · Profile · 600 searches/day limit
   ============================================================ */

// ─── FIREBASE CONFIG ─────────────────────────────────────────
// Replace these values with your own Firebase project config
// Get from: Firebase Console → Project Settings → Your apps → Web app
const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyB6-ewxa3XefH8JZw3chfxALdpbnJIVto4',
  authDomain:        'musiq-agent.firebaseapp.com',
  projectId:         'musiq-agent',
  storageBucket:     'musiq-agent.firebasestorage.app',
  messagingSenderId: '887656964593',
  appId:             '1:887656964593:web:a69338c02ec6b7a60be450',
};

// ─── CONSTANTS ────────────────────────────────────────────────
const DAILY_LIMIT   = 600;
const OTP_TIMEOUT   = 60;   // seconds before resend allowed
const SESSION_KEY   = 'musiq_session';
const USAGE_KEY     = 'musiq_usage';

// ─── STATE ────────────────────────────────────────────────────
let firebaseApp  = null;
let firebaseAuth = null;
let firebaseDB   = null;
let recaptchaVerifier     = null;
let confirmationResult    = null;
let otpResendTimer        = null;
let currentUser           = null;
let currentUserProfile    = null;

// ─── INIT FIREBASE ───────────────────────────────────────────
async function initFirebase() {
  if (firebaseApp) return; // already initialised

  // Dynamically load Firebase SDKs (no npm needed)
  await loadScript('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
  await loadScript('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js');
  await loadScript('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js');

  firebaseApp  = firebase.initializeApp(FIREBASE_CONFIG);
  firebaseAuth = firebase.auth();
  firebaseDB   = firebase.firestore();

  // Listen to auth state changes
  firebaseAuth.onAuthStateChanged(onAuthStateChanged);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ─── AUTH STATE LISTENER ──────────────────────────────────────
async function onAuthStateChanged(user) {
  if (user) {
    // User is signed in
    currentUser = user;
    const profile = await loadUserProfile(user.uid);

    if (!profile) {
      // Signed in but no profile — show registration
      showScreen('screen-register');
    } else {
      currentUserProfile = profile;
      finalizeLogin(profile);
    }
  } else {
    // Not signed in — show login
    currentUser = null;
    currentUserProfile = null;
    showScreen('screen-login');
  }
}

// ─── SHOW / HIDE AUTH OVERLAY ─────────────────────────────────
function showAuthOverlay() {
  document.getElementById('auth-overlay').style.display = 'flex';
  document.getElementById('main-content').style.display = 'none';
  document.querySelector('.sidebar').style.display      = 'none';
  document.querySelector('.mobile-header') &&
    (document.querySelector('.mobile-header').style.display = 'none');
}

function hideAuthOverlay() {
  document.getElementById('auth-overlay').style.display = 'none';
  document.getElementById('main-content').style.display = '';
  document.querySelector('.sidebar').style.display      = '';
  const mh = document.querySelector('.mobile-header');
  if (mh) mh.style.display = '';
}

function showScreen(id) {
  document.querySelectorAll('.auth-screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
  showAuthOverlay();
}

// ─── STEP 1: SEND OTP ─────────────────────────────────────────
async function sendOTP() {
  const phone   = document.getElementById('auth-phone').value.trim();
  const cc      = document.getElementById('auth-cc').value;
  const fullNum = cc + phone.replace(/^0+/, '');

  if (!phone || phone.length < 7) {
    showAuthError('login', 'Enter a valid mobile number');
    return;
  }

  setAuthLoading('login', true, 'Sending OTP…');
  clearAuthError('login');

  try {
    await initFirebase();

    // Set up reCAPTCHA (invisible)
    if (!recaptchaVerifier) {
      recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
        size: 'invisible',
        callback: () => {},
      });
    }

    confirmationResult = await firebaseAuth.signInWithPhoneNumber(fullNum, recaptchaVerifier);

    // Store number for OTP screen display
    document.getElementById('otp-phone-display').textContent = fullNum;
    setAuthLoading('login', false);
    showScreen('screen-otp');
    startOtpTimer();

  } catch (err) {
    setAuthLoading('login', false);
    recaptchaVerifier = null; // reset on error
    showAuthError('login', friendlyFirebaseError(err));
    console.error('sendOTP error:', err);
  }
}

// ─── STEP 2: VERIFY OTP ───────────────────────────────────────
async function verifyOTP() {
  const code = document.getElementById('otp-input').value.trim();
  if (code.length !== 6) {
    showAuthError('otp', 'Enter the 6-digit code');
    return;
  }

  setAuthLoading('otp', true, 'Verifying…');
  clearAuthError('otp');

  try {
    const result = await confirmationResult.confirm(code);
    currentUser = result.user;
    // onAuthStateChanged fires automatically — handles routing to register or app
    setAuthLoading('otp', false);
  } catch (err) {
    setAuthLoading('otp', false);
    showAuthError('otp', 'Invalid code. Please try again.');
    console.error('verifyOTP error:', err);
  }
}

// ─── STEP 3: SAVE PROFILE ─────────────────────────────────────
async function saveProfile() {
  const name    = document.getElementById('reg-name').value.trim();
  const email   = document.getElementById('reg-email').value.trim();
  const dob     = document.getElementById('reg-dob').value;
  const country = document.getElementById('reg-country').value;
  const genres  = Array.from(document.querySelectorAll('.genre-checkbox:checked')).map(c => c.value);

  if (!name)    { showAuthError('register', 'Name is required'); return; }
  if (!email || !email.includes('@')) { showAuthError('register', 'Enter a valid email'); return; }
  if (!dob)     { showAuthError('register', 'Date of birth is required'); return; }
  if (!country) { showAuthError('register', 'Select your country'); return; }

  setAuthLoading('register', true, 'Saving profile…');
  clearAuthError('register');

  try {
    const profile = {
      uid:       currentUser.uid,
      phone:     currentUser.phoneNumber,
      name,
      email,
      dob,
      country,
      genres,
      createdAt: new Date().toISOString(),
      plan:      'free',
      dailyLimit: DAILY_LIMIT,
    };

    await firebaseDB.collection('users').doc(currentUser.uid).set(profile);
    currentUserProfile = profile;
    setAuthLoading('register', false);
    finalizeLogin(profile);

  } catch (err) {
    setAuthLoading('register', false);
    showAuthError('register', 'Failed to save profile. Try again.');
    console.error('saveProfile error:', err);
  }
}

// ─── LOAD USER PROFILE ────────────────────────────────────────
async function loadUserProfile(uid) {
  try {
    const doc = await firebaseDB.collection('users').doc(uid).get();
    return doc.exists ? doc.data() : null;
  } catch (err) {
    console.error('loadUserProfile error:', err);
    return null;
  }
}

// ─── FINALIZE LOGIN ───────────────────────────────────────────
function finalizeLogin(profile) {
  // Update sidebar avatar + name
  updateSidebarProfile(profile);
  // Hide auth overlay, show app
  hideAuthOverlay();
  // Check today's usage
  syncUsageFromFirebase(profile.uid);
  showToast(`Welcome back, ${profile.name.split(' ')[0]}! 🎵`);
}

function updateSidebarProfile(profile) {
  const el = document.getElementById('sidebar-profile');
  if (!el) return;
  const initials = profile.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  el.innerHTML = `
    <div class="profile-avatar" onclick="showView('profile', this)">${initials}</div>
    <div class="profile-info" onclick="showView('profile', this)">
      <div class="profile-name">${escHTML(profile.name)}</div>
      <div class="profile-usage" id="profile-usage-label">Loading…</div>
    </div>
    <button class="profile-logout" title="Sign out" onclick="signOut()">
      <i class="fa-solid fa-arrow-right-from-bracket"></i>
    </button>`;
}

// ─── SIGN OUT ─────────────────────────────────────────────────
async function signOut() {
  if (!confirm('Sign out of Musiq?')) return;
  await firebaseAuth.signOut();
  currentUser = null;
  currentUserProfile = null;
  showToast('Signed out');
}

// ─── DAILY USAGE TRACKING ─────────────────────────────────────
function getTodayKey() {
  return new Date().toISOString().slice(0, 10); // "2026-05-12"
}

function getLocalUsage() {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (!raw) return { date: getTodayKey(), count: 0 };
    const u = JSON.parse(raw);
    // Reset if it's a new day
    if (u.date !== getTodayKey()) return { date: getTodayKey(), count: 0 };
    return u;
  } catch { return { date: getTodayKey(), count: 0 }; }
}

function saveLocalUsage(count) {
  localStorage.setItem(USAGE_KEY, JSON.stringify({ date: getTodayKey(), count }));
}

async function syncUsageFromFirebase(uid) {
  try {
    const todayKey = getTodayKey();
    const doc = await firebaseDB.collection('usage').doc(`${uid}_${todayKey}`).get();
    const count = doc.exists ? (doc.data().count || 0) : 0;
    saveLocalUsage(count);
    updateUsageUI(count);
  } catch {
    // Fallback to local
    const u = getLocalUsage();
    updateUsageUI(u.count);
  }
}

async function incrementUsage() {
  const u = getLocalUsage();
  const newCount = u.count + 1;
  saveLocalUsage(newCount);
  updateUsageUI(newCount);

  // Sync to Firestore in background (don't await — don't block the search)
  if (currentUser) {
    const todayKey = getTodayKey();
    firebaseDB.collection('usage').doc(`${currentUser.uid}_${todayKey}`).set(
      { uid: currentUser.uid, date: todayKey, count: newCount, updatedAt: new Date().toISOString() },
      { merge: true }
    ).catch(() => {}); // silent fail
  }

  return newCount;
}

function updateUsageUI(count) {
  const remaining = Math.max(0, DAILY_LIMIT - count);
  const pct       = Math.round((count / DAILY_LIMIT) * 100);

  // Sidebar label
  const label = document.getElementById('profile-usage-label');
  if (label) {
    label.textContent = `${remaining} searches left today`;
    label.style.color = remaining < 50 ? 'var(--accent2)' : '';
  }

  // Profile view
  const bar   = document.getElementById('usage-bar-fill');
  const text  = document.getElementById('usage-bar-text');
  const count2 = document.getElementById('usage-count');
  if (bar)   bar.style.width = `${pct}%`;
  if (bar)   bar.style.background = remaining < 50 ? '#ff6b9d' : remaining < 100 ? '#ffa500' : 'var(--accent)';
  if (text)  text.textContent = `${count} / ${DAILY_LIMIT} searches used today`;
  if (count2) count2.textContent = count;
}

// ─── CHECK LIMIT BEFORE SEARCH ────────────────────────────────
// Called by agent.js before every fetchSongs()
function checkDailyLimit() {
  if (!currentUser) return true; // not logged in — let agent.js handle

  const u = getLocalUsage();
  if (u.count >= DAILY_LIMIT) {
    showLimitModal();
    return false; // block the search
  }
  return true; // allow
}

// ─── LIMIT REACHED POPUP ──────────────────────────────────────
function showLimitModal() {
  const u         = getLocalUsage();
  const resetTime = new Date();
  resetTime.setDate(resetTime.getDate() + 1);
  resetTime.setHours(0, 0, 0, 0);
  const hoursLeft = Math.ceil((resetTime - Date.now()) / 3600000);

  document.getElementById('limit-modal').classList.add('open');
  const msg = document.getElementById('limit-modal-msg');
  if (msg) msg.textContent = `You've used all ${DAILY_LIMIT} searches for today. Your limit resets in ~${hoursLeft} hour${hoursLeft !== 1 ? 's' : ''} at midnight.`;
}

function closeLimitModal() {
  document.getElementById('limit-modal').classList.remove('open');
}

// ─── OTP RESEND TIMER ─────────────────────────────────────────
function startOtpTimer() {
  let secs = OTP_TIMEOUT;
  const btn = document.getElementById('otp-resend-btn');
  const lbl = document.getElementById('otp-timer-label');
  if (btn) btn.disabled = true;

  clearInterval(otpResendTimer);
  otpResendTimer = setInterval(() => {
    secs--;
    if (lbl) lbl.textContent = `Resend in ${secs}s`;
    if (secs <= 0) {
      clearInterval(otpResendTimer);
      if (btn) btn.disabled = false;
      if (lbl) lbl.textContent = '';
    }
  }, 1000);
}

async function resendOTP() {
  confirmationResult = null;
  recaptchaVerifier  = null;
  showScreen('screen-login');
  showAuthError('login', 'Re-enter your number to resend the OTP.');
}

// ─── OTP INPUT AUTO-ADVANCE ───────────────────────────────────
function setupOtpInput() {
  const inputs = document.querySelectorAll('.otp-digit');
  inputs.forEach((input, i) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 1);
      if (input.value && i < inputs.length - 1) inputs[i + 1].focus();
      // Combine into hidden field
      document.getElementById('otp-input').value =
        Array.from(inputs).map(inp => inp.value).join('');
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !input.value && i > 0) inputs[i - 1].focus();
    });
    input.addEventListener('paste', e => {
      const paste = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g,'');
      inputs.forEach((inp, idx) => { inp.value = paste[idx] || ''; });
      document.getElementById('otp-input').value = paste.slice(0, 6);
      e.preventDefault();
    });
  });
}

// ─── PROFILE VIEW ─────────────────────────────────────────────
function renderProfileView() {
  if (!currentUserProfile) return;
  const p = currentUserProfile;
  const u = getLocalUsage();
  const remaining = Math.max(0, DAILY_LIMIT - u.count);
  const pct       = Math.round((u.count / DAILY_LIMIT) * 100);
  const initials  = p.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  const el = document.getElementById('view-profile');
  if (!el) return;
  el.innerHTML = `
    <div class="profile-page">
      <div class="profile-hero">
        <div class="profile-hero-avatar">${initials}</div>
        <div class="profile-hero-info">
          <h1 class="profile-hero-name">${escHTML(p.name)}</h1>
          <p class="profile-hero-phone">${escHTML(p.phone || '')}</p>
          <span class="profile-plan-badge">${p.plan === 'premium' ? '⭐ Premium' : 'Free Plan'}</span>
        </div>
      </div>

      <div class="profile-section">
        <h3 class="profile-section-title">Daily Usage</h3>
        <div class="usage-card">
          <div class="usage-numbers">
            <span class="usage-big" id="usage-count">${u.count}</span>
            <span class="usage-sep">/ ${DAILY_LIMIT}</span>
            <span class="usage-label">searches today</span>
          </div>
          <div class="usage-track">
            <div class="usage-fill" id="usage-bar-fill" style="width:${pct}%;background:${remaining < 50 ? '#ff6b9d' : remaining < 100 ? '#ffa500' : 'var(--accent)'};"></div>
          </div>
          <p class="usage-remaining" id="usage-bar-text">${u.count} / ${DAILY_LIMIT} searches used today</p>
          <p class="usage-reset">Resets at midnight · ${remaining} searches remaining</p>
        </div>
      </div>

      <div class="profile-section">
        <h3 class="profile-section-title">Profile details</h3>
        <div class="profile-details-grid">
          <div class="pd-row"><span class="pd-label">Name</span><span class="pd-val">${escHTML(p.name)}</span></div>
          <div class="pd-row"><span class="pd-label">Email</span><span class="pd-val">${escHTML(p.email || '—')}</span></div>
          <div class="pd-row"><span class="pd-label">Date of birth</span><span class="pd-val">${escHTML(p.dob || '—')}</span></div>
          <div class="pd-row"><span class="pd-label">Country</span><span class="pd-val">${escHTML(p.country || '—')}</span></div>
          <div class="pd-row"><span class="pd-label">Phone</span><span class="pd-val">${escHTML(p.phone || '—')}</span></div>
          <div class="pd-row"><span class="pd-label">Member since</span><span class="pd-val">${p.createdAt ? new Date(p.createdAt).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}) : '—'}</span></div>
        </div>
      </div>

      ${p.genres?.length ? `
      <div class="profile-section">
        <h3 class="profile-section-title">Favourite genres</h3>
        <div class="profile-genres">
          ${p.genres.map(g => `<span class="tag tag-genre">${escHTML(g)}</span>`).join('')}
        </div>
      </div>` : ''}

      <div class="profile-section">
        <button class="btn-signout" onclick="signOut()">
          <i class="fa-solid fa-arrow-right-from-bracket"></i> Sign out
        </button>
      </div>
    </div>`;
}

// ─── HELPERS ──────────────────────────────────────────────────
function showAuthError(screen, msg) {
  const el = document.getElementById(`auth-error-${screen}`);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function clearAuthError(screen) {
  const el = document.getElementById(`auth-error-${screen}`);
  if (el) { el.textContent = ''; el.style.display = 'none'; }
}

function setAuthLoading(screen, on, msg) {
  const btn = document.getElementById(`auth-btn-${screen}`);
  const lbl = document.getElementById(`auth-btn-label-${screen}`);
  if (btn) btn.disabled = on;
  if (lbl && msg) lbl.textContent = on ? msg : lbl.dataset.default;
}

function friendlyFirebaseError(err) {
  const map = {
    'auth/invalid-phone-number':      'Invalid phone number. Include country code.',
    'auth/too-many-requests':         'Too many attempts. Please wait a few minutes.',
    'auth/quota-exceeded':            'SMS quota exceeded. Try again later.',
    'auth/network-request-failed':    'Network error. Check your connection.',
    'auth/code-expired':              'OTP expired. Please request a new one.',
    'auth/invalid-verification-code': 'Wrong code. Please check and try again.',
  };
  return map[err.code] || err.message || 'Something went wrong. Please try again.';
}

function escHTML(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── BOOT ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  setupOtpInput();

  // Check if Firebase is configured with real values
  const isFirebaseConfigured = (
    FIREBASE_CONFIG.apiKey !== 'YOUR_FIREBASE_API_KEY' &&
    FIREBASE_CONFIG.apiKey !== '' &&
    !FIREBASE_CONFIG.apiKey.includes('YOUR_')
  );

  if (!isFirebaseConfigured) {
    // Firebase not set up yet — skip login, go straight to app
    console.warn('[Auth] Firebase not configured — bypassing login for now.');
    console.warn('[Auth] Follow README Step 2 to set up Firebase.');
    hideAuthOverlay();
    showToast('Firebase not set up — running without login. See README Step 2.');
    return;
  }

  await initFirebase();
  // onAuthStateChanged fires automatically after initFirebase
});