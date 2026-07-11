/* ============================================================
   Inventory App — Event Equipment · Toolbox · Food
   Three sectors, per-event tracking, checker accountability.
   Data stored in cloud (Firestore) + local cache (localStorage).
   Email/Password login — only approved emails can sign up.
   ============================================================ */

'use strict';

var LS_KEY = 'cci-inventory-v1';
var PESO = '₱';

/* ---------- Firebase / Auth ---------- */
var fsDB = null;
try { fsDB = firebase.firestore(); } catch (e) { console.error('Firestore init error', e); }
var CLOUD_DOC = fsDB ? fsDB.collection('inventory').doc('main') : null;

var fbAuth = null;
try { fbAuth = firebase.auth(); } catch (e) { console.error('Auth init error', e); }

// REPLACE this with the real email of each staff member who is allowed to sign up
var ALLOWED_EMAILS = [
  'carl.cocktailsmanila@gmail.com',
  'meanne@gmail.com',
  'evelyn.cocktailsmanila@gmail.com',
  'guiller.cocktailsmanila@gmail.com',
  'ace.cocktailsmanila@gmail.com',
  'eman.cocktailsmanila@gmail.com',
  'jays.cocktailsmanila@gmail.com',
  'jewel.cocktailsmanila@gmail.com',
  'jissel.cocktailsmanila@gmail.com',
  'johnpaul.cocktailsmanila@gmail.com',
  'johnwilfred.cocktailsmanila@gmail.com',
  'patrick.cocktailsmanila@gmail.com',
  'paula.cocktailsmanila@gmail.com',
  'sofia.cocktailsmanila@gmail.com',
  'dan.cocktailsmanila@gmail.com'
];

/* CHANGED: role system — emails listed here get FULL ACCESS (admin).
   Everyone else who signs in is Event Staff (Events tab only). */
var ADMIN_EMAILS = [
  'carl.cocktailsmanila@gmail.com',
  'meanne@gmail.com'
];

function isAdmin() {
  return !!(currentUser && currentUser.email && ADMIN_EMAILS.indexOf(currentUser.email.toLowerCase()) >= 0);
}

/* CHANGED: staff can only edit records within 3 hours of encoding them.
   Admins can edit anytime. Returns are NOT affected by this limit. */
var EDIT_WINDOW_MS = 3 * 60 * 60 * 1000;
function canEditRecord(ts) {
  if (isAdmin()) return true;
  return !!ts && (Date.now() - ts) < EDIT_WINDOW_MS;
}

/* CHANGED: map each account email to a display name.
   Used to auto-fill the "Lead" field with whoever is logged in. */
var STAFF_NAMES = {
  'carl.cocktailsmanila@gmail.com': 'Carl',
  'meanne@gmail.com': 'Meanne',
  'evelyn.cocktailsmanila@gmail.com': 'Evelyn',
  'guiller.cocktailsmanila@gmail.com': 'Guiller',
  'ace.cocktailsmanila@gmail.com': 'Ace',
  'eman.cocktailsmanila@gmail.com': 'Eman',
  'jays.cocktailsmanila@gmail.com': 'Jays',
  'jewel.cocktailsmanila@gmail.com': 'Jewel',
  'jissel.cocktailsmanila@gmail.com': 'Jissel',
  'johnpaul.cocktailsmanila@gmail.com': 'John Paul',
  'johnwilfred.cocktailsmanila@gmail.com': 'John Wilfred',
  'patrick.cocktailsmanila@gmail.com': 'Patrick',
  'paula.cocktailsmanila@gmail.com': 'Paula',
  'sofia.cocktailsmanila@gmail.com': 'Sofia',
  'dan.cocktailsmanila@gmail.com': 'Dan'
};

function currentUserName() {
  if (!currentUser || !currentUser.email) return '';
  var e = currentUser.email.toLowerCase();
  if (STAFF_NAMES[e]) return STAFF_NAMES[e];
  /* fallback: use only the FIRST word of the email (before any . _ - or @),
     e.g. evelyn.cocktailsmanila@gmail.com → "Evelyn" */
  var n = e.split('@')[0].split(/[._-]/)[0];
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/* CHANGED: Lead dropdown options — staff names only (admins excluded).
   If an old event has a lead name not in the list, it's kept so editing
   doesn't accidentally change it. */
function staffNameOptions(selected) {
  var names = [];
  for (var e in STAFF_NAMES) {
    if (ADMIN_EMAILS.indexOf(e) >= 0) continue;
    if (names.indexOf(STAFF_NAMES[e]) < 0) names.push(STAFF_NAMES[e]);
  }
  names.sort();
  if (selected && names.indexOf(selected) < 0) names.unshift(selected);
  var html = '<option value=""' + (!selected ? ' selected' : '') + '>— Select lead —</option>';
  html += names.map(function (n) {
    return '<option value="' + esc(n) + '"' + (n === selected ? ' selected' : '') + '>' + esc(n) + '</option>';
  }).join('');
  return html;
}

var currentUser = null;
var authMode = 'signin';   // 'signin' or 'signup'

function isAllowed(email) {
  return email && ALLOWED_EMAILS.indexOf(email.toLowerCase()) >= 0;
}
function switchAuthMode(mode) {
  authMode = mode;
  renderLoginScreen();
}
function doForgotPassword() {
  var email = document.getElementById('login_email').value.trim();
  if (!email) { alert('Please enter your email first, then tap "Forgot password?" again.'); return; }
  fbAuth.sendPasswordResetEmail(email).then(function () {
    alert('A password reset link has been sent to ' + email + '. Please check your inbox (and spam folder).');
  }).catch(function (err) {
    console.error('Password reset error', err);
    alert('Could not send reset email: ' + err.message);
  });
}
function togglePasswordView() {
  var input = document.getElementById('login_pass');
  var btn = event.target;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'Hide';
  } else {
    input.type = 'password';
    btn.textContent = 'Show';
  }
}
function doLogin() {
  var id = document.getElementById('login_email').value.trim();
  var pass = document.getElementById('login_pass').value;
  if (!id || !pass) { alert('Enter your email/username and password.'); return; }
  /* CHANGED: allow signing in with a short username — looked up in the
     'usernames' collection to find the matching email */
  if (id.indexOf('@') >= 0) {
    signInEmail(id, pass);
  } else {
    if (!fsDB) { alert('No connection — please try your full email instead.'); return; }
    fsDB.collection('usernames').doc(id.toLowerCase()).get().then(function (snap) {
      if (snap.exists && snap.data().email) {
        signInEmail(snap.data().email, pass);
      } else {
        alert('Username not found. Try your full email, or set a username from the Menu after logging in.');
      }
    }).catch(function (err) {
      console.error('Username lookup error', err);
      alert('Could not check that username. Please try your full email instead.');
    });
  }
}

function signInEmail(email, pass) {
  fbAuth.signInWithEmailAndPassword(email, pass).catch(function (err) {
    console.error('Login error', err);
    alert('Wrong email/username or password. Please try again.');
  });
}
function doSignup() {
  var email = document.getElementById('login_email').value.trim();
  var pass = document.getElementById('login_pass').value;
  if (!email || !pass) { alert('Enter your email and password.'); return; }
  /* CHANGED: actually enforce the approved-emails list on signup */
  if (!isAllowed(email)) { alert('This email is not approved to create an account. Ask the admin to add it first.'); return; }
  if (pass.length < 6) { alert('Password must be at least 6 characters.'); return; }
  fbAuth.createUserWithEmailAndPassword(email, pass).catch(function (err) {
    console.error('Signup error', err);
    alert('Could not create account: ' + err.message);
  });
}
function doLogout() {
  /* CHANGED: close the menu/any open modal before signing out */
  closeModal();
  fbAuth.signOut();
}

function renderLoginScreen() {
  /* CHANGED: make sure no modal is left open on top of the login screen */
  var mo = document.getElementById('modalOverlay');
  if (mo) { mo.classList.add('hidden'); document.getElementById('modal').innerHTML = ''; }
  var nav = document.querySelector('.bottomnav');
  if (nav) nav.style.display = 'none';
  var menuBtn = document.querySelector('.icon-btn');
  if (menuBtn) menuBtn.style.display = 'none';
  var v = document.getElementById('view');
  /* CHANGED: sign-up and forgot-password removed — the admin creates all accounts
     directly in Firebase Console (Authentication → Users → Add user) */
  v.innerHTML =
    '<div style="text-align:center;padding:60px 20px">' +
      '<img src="logo.png" alt="Cocktails Manila" style="width:110px;height:110px;object-fit:contain;margin-bottom:12px">' +
      '<h2 style="margin-bottom:6px">Cocktails Manila Inventory</h2>' +
      '<p class="hint">Sign in with the account given to you by the admin.</p>' +
      '<div style="max-width:280px;margin:16px auto;text-align:left">' +
        '<div class="field"><label>Email or Username</label><input id="login_email" type="text" autocapitalize="none" placeholder="you@example.com or username"></div>' +
        '<div class="field"><label>Password</label>' +
          '<div style="position:relative">' +
            '<input id="login_pass" type="password" placeholder="Password" style="padding-right:60px">' +
            '<button type="button" onclick="togglePasswordView()" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:#1a7f5a;font-size:13px;cursor:pointer;padding:4px">Show</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '<button class="btn btn-primary" onclick="doLogin()">Sign In</button>' +
    '<div class="hint" style="margin-top:12px">No account or forgot your password? Contact the admin.</div>' +
    '</div>';
}

/* ---------- state ---------- */
var db = loadDB();
var route = { tab: 'events', eventId: null, lead: null };
/* CHANGED: remember the last tab/page, so a refresh brings you back
   to where you were instead of always returning to Events */
try {
  var _savedRoute = JSON.parse(localStorage.getItem('cci-route') || 'null');
  if (_savedRoute && _savedRoute.tab) route = _savedRoute;
} catch (e) { }
var dbSearch = '';
var dbFilter = 'all';
var dbTab = 'event';   // 'event' | 'toolbox' | 'food'
var dbMaterialFilter = 'all';
var foodCatFilter = 'all'; /* CHANGED: category filter for the Food tab */
var photoTemp = null;
var photoCallback = null;
var pickerCallback = null;

/* ---------- storage ---------- */
function loadDB() {
  try {
    var raw = localStorage.getItem(LS_KEY);
    if (raw) {
      var d = JSON.parse(raw);
      if (d && d.items && d.events && d.deliveries) return d;
    }
  } catch (e) { }
  return seedDB();
}

function saveDB() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(db));
  } catch (e) { }
  if (CLOUD_DOC) {
    CLOUD_DOC.set(db).catch(function (e) {
      console.error('Cloud save error', e);
      toast('No internet — not synced to other devices.');
    });
  } else {
    alert('Could not save! Device storage may be full. Export a backup and delete old photos.');
  }
}

function seedDB() {
  function it(name, category, opts) {
    var o = opts || {};
    return {
      id: uid(), name: name, category: category,
      disposable: !!o.disposable,
      unit: o.unit || 'pcs',
      price: o.price || 0,
      owned: o.owned || 0,
      stock: o.stock || 0,
      reorderPoint: o.reorder || 0,
      material: o.material || '',
      photo: null, notes: ''
    };
  }
  return {
    version: 1,
    items: [
      it('Chafing Dish', 'event', { owned: 12, price: 1500, material: 'Metal' }),
      it('Round Table', 'event', { owned: 20, price: 900, material: 'Wood' }),
      it('Monoblock Chair', 'event', { owned: 100, price: 250 }),
      it('Serving Tray (Stainless)', 'toolbox', { owned: 15, price: 350 }),
      it('Ice Bucket', 'toolbox', { owned: 6, price: 400 }),
      it('Paper Cups', 'toolbox', { disposable: true, stock: 500, reorder: 100, price: 1.5, unit: 'pcs' }),
      it('Food Container (Microwavable)', 'toolbox', { disposable: true, stock: 200, reorder: 50, price: 6, unit: 'pcs' }),
      it('Chicken (Whole)', 'food', { stock: 10, reorder: 4, price: 220, unit: 'kg' }),
      it('Rice', 'food', { stock: 50, reorder: 15, price: 52, unit: 'kg' }),
      it('Cooking Oil', 'food', { stock: 8, reorder: 3, price: 160, unit: 'L' })
    ],
    events: [],
    deliveries: []
  };
}

/* ---------- utils ---------- */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
function money(n) {
  return PESO + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function today() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fmtDate(iso) {
  if (!iso) return '—';
  var p = iso.split('-');
  if (p.length !== 3) return iso;
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[(+p[1]) - 1] + ' ' + (+p[2]) + ', ' + p[0];
}

/* CHANGED: activity log — records who did what, and when.
   Kept to the latest 300 actions so the data stays small. */
function nowStamp() {
  var d = new Date();
  return today() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function logAction(text) {
  if (!db.logs) db.logs = [];
  db.logs.unshift({ id: uid(), at: nowStamp(), by: currentUserName() || 'Unknown', text: text });
  if (db.logs.length > 300) db.logs.length = 300;
}
function getItem(id) {
  for (var i = 0; i < db.items.length; i++) if (db.items[i].id === id) return db.items[i];
  return null;
}
function getEvent(id) {
  for (var i = 0; i < db.events.length; i++) if (db.events[i].id === id) return db.events[i];
  return null;
}
function catLabel(it) {
  if (it.category === 'event') return 'Event Item';
  if (it.category === 'food') return 'Food';
  return it.disposable ? 'Toolbox · Disposable' : 'Toolbox · Returnable';
}
/* CHANGED: clean line icons (same style as the bottom nav) used inside the app */
var SVG_ICONS = {
  tent: '<path d="M12 4 3 20h18L12 4z"/><path d="M12 13l-3.5 7"/><path d="M12 13l3.5 7"/>',
  box: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  bowl: '<path d="M4 12h16a8 8 0 0 1-8 8 8 8 0 0 1-8-8z"/><path d="M9 4c0 1.5 1 1.5 1 3"/><path d="M14 4c0 1.5 1 1.5 1 3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  log: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 8 12 3 17 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  sheet: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'
};

function svgIcon(name, size) {
  size = size || 18;
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;vertical-align:-3px">' + (SVG_ICONS[name] || '') + '</svg>';
}

function catIcon(it) {
  if (it.category === 'event') return svgIcon('tent', 22);
  if (it.category === 'food') return svgIcon('bowl', 22);
  return svgIcon('box', 22);
}
function isConsumable(it) {
  return it.category === 'food' || (it.category === 'toolbox' && it.disposable);
}

/* ---------- derived numbers ---------- */
function totalDamagedLost(itemId) {
  var t = 0;
  db.events.forEach(function (ev) {
    (ev.lines || []).forEach(function (l) {
      if (l.itemId === itemId) t += (l.damaged || 0) + (l.lost || 0);
    });
  });
  return t;
}
function pendingOut(itemId) {
  var t = 0;
  db.events.forEach(function (ev) {
    if (ev.status !== 'open') return;
    (ev.lines || []).forEach(function (l) {
      if (l.itemId === itemId) t += Math.max(0, (l.out || 0) - (l.returned || 0) - (l.damaged || 0) - (l.lost || 0));
    });
  });
  return t;
}
function ownedEffective(it) { return Math.max(0, (it.owned || 0) - totalDamagedLost(it.id)); }
function availableNow(it) {
  if (isConsumable(it)) return it.stock || 0;
  return Math.max(0, ownedEffective(it) - pendingOut(it.id));
}
function linePending(l) {
  return Math.max(0, (l.out || 0) - (l.returned || 0) - (l.damaged || 0) - (l.lost || 0));
}
function eventPending(ev) {
  var t = 0;
  (ev.lines || []).forEach(function (l) { t += linePending(l); });
  return t;
}
function eventIssues(ev) {
  var t = 0;
  (ev.lines || []).forEach(function (l) { t += (l.damaged || 0) + (l.lost || 0); });
  return t;
}
function eventDamageValue(ev) {
  var t = 0;
  (ev.lines || []).forEach(function (l) {
    var it = getItem(l.itemId);
    if (it) t += ((l.damaged || 0) + (l.lost || 0)) * (it.price || 0);
  });
  return t;
}
function eventValueOut(ev) {
  var t = 0;
  (ev.lines || []).forEach(function (l) {
    var it = getItem(l.itemId);
    if (it) t += (l.out || 0) * (it.price || 0);
  });
  return t;
}
function eventUsageCost(ev, category) {
  var t = 0;
  (ev.usage || []).forEach(function (u) {
    var it = getItem(u.itemId);
    if (!it) return;
    if (category && it.category !== category) return;
    t += (u.qty || 0) * (u.cost != null ? u.cost : (it.price || 0));
  });
  return t;
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function go(tab, param) {
  route.tab = tab;
  route.eventId = tab === 'eventDetail' ? param : null;
  route.lead = tab === 'leadDetail' ? param : null;
  /* CHANGED: save the current page so refresh returns here */
  try { localStorage.setItem('cci-route', JSON.stringify(route)); } catch (e) { }
  render();
  window.scrollTo(0, 0);
}

function goHomeOrEvents() { go('home'); }

function render() {
  if (fbAuth && !currentUser) { renderLoginScreen(); return; }
  var nav = document.querySelector('.bottomnav');
  if (nav) nav.style.display = '';
  var menuBtn = document.querySelector('.icon-btn');
  if (menuBtn) menuBtn.style.display = '';
  /* CHANGED: staff (non-admin) can use Home + Events + Leads tabs.
     Home shows their personal dashboard; Leads stays view-only. */
  var admin = isAdmin();
  var staffTabs = ['home', 'events', 'eventDetail', 'leads', 'leadDetail'];
  if (!admin && staffTabs.indexOf(route.tab) < 0) {
    route.tab = 'home'; route.eventId = null; route.lead = null;
  }
  var navTab = route.tab;
  if (navTab === 'eventDetail') navTab = 'events';
  if (navTab === 'leadDetail') navTab = 'leads';
  document.querySelectorAll('.bottomnav button').forEach(function (b) {
    var t = b.getAttribute('data-tab');
    b.style.display = (admin || t === 'home' || t === 'events' || t === 'leads') ? '' : 'none';
    b.classList.toggle('active', t === navTab);
  });
  /* CHANGED: the Records tab is "My Records" for staff, "Records" for admin */
  var leadsLbl = document.getElementById('leadsTabLabel');
  if (leadsLbl) leadsLbl.textContent = admin ? 'Records' : 'My Records';
  var v = document.getElementById('view');
  if (route.tab === 'home') v.innerHTML = admin ? renderHome() : renderStaffHome();
  else if (route.tab === 'db') v.innerHTML = renderDatabase();
  else if (route.tab === 'events') v.innerHTML = renderEvents();
  else if (route.tab === 'eventDetail') v.innerHTML = renderEventDetail(route.eventId);
  else if (route.tab === 'toolbox') v.innerHTML = renderToolbox();
  else if (route.tab === 'food') v.innerHTML = renderFood();
  else if (route.tab === 'leads') v.innerHTML = admin ? renderLeads() : renderLeadDetail(myLeadName());
  else if (route.tab === 'leadDetail') v.innerHTML = renderLeadDetail(route.lead);
}

/* ============================================================
   TAB: HOME (admin dashboard)
   ============================================================ */
function renderHome() {
  var h = new Date().getHours();
  var greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  var td = today();

  /* totals */
  var invValue = 0;
  var lowItems = [];
  db.items.forEach(function (it) {
    if (isConsumable(it)) {
      invValue += (it.stock || 0) * (it.price || 0);
      if (isLow(it)) lowItems.push(it);
    } else {
      invValue += ownedEffective(it) * (it.price || 0);
    }
  });

  var month = td.slice(0, 7);
  var dmgMonth = 0;
  db.events.forEach(function (ev) {
    if ((ev.date || '').slice(0, 7) === month) dmgMonth += eventDamageValue(ev);
  });

  var pendTotal = 0, pastOpenCount = 0;
  db.events.forEach(function (ev) {
    if (ev.status !== 'open') return;
    pendTotal += eventPending(ev);
    if ((ev.date || '') < td) pastOpenCount++;
  });

  var html = '<div style="margin:6px 2px 4px">' +
    '<div style="font-size:20px;font-weight:800">' + greet + ', ' + esc(currentUserName()) + '!</div>' +
    '<div class="hint">' + fmtDate(td) + ' · Here\'s how Cocktails Manila looks today.</div>' +
    '</div>';

  html += '<div class="tiles">' +
    tile(money(invValue), 'Total inventory value') +
    tile(money(dmgMonth), 'Damage/lost this month', dmgMonth > 0 ? 'bad' : '') +
    tile(String(pendTotal), 'Items still out', pendTotal > 0 ? 'bad' : '') +
    tile(String(lowItems.length), 'Low stock items', lowItems.length ? 'bad' : '') +
    '</div>';

  if (pastOpenCount > 0) {
    html += '<div class="notice amber">' + pastOpenCount + ' event(s) past their date are still open — review and close them in the Events tab.</div>';
  }

  if (lowItems.length) {
    html += '<div class="section-title">Reorder Soon</div>';
    lowItems.sort(byName).slice(0, 5).forEach(function (it) { html += itemCard(it); });
  }

  return html;
}

/* CHANGED: staff Home — a personal dashboard: my events today, items I still
   need to return, and my damage record this month */
function renderStaffHome() {
  var h = new Date().getHours();
  var greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  var td = today();
  var myName = currentUserName();
  var myKey = myName.toLowerCase();

  var mine = db.events.filter(function (ev) {
    return (ev.lead || '').trim().toLowerCase() === myKey;
  });
  var myOpen = mine.filter(function (e) { return e.status === 'open'; });
  var todayEvents = myOpen.filter(function (e) { return e.date === td; });

  var pendTotal = 0;
  myOpen.forEach(function (ev) {
    pendTotal += eventPending(ev);
  });

  var month = td.slice(0, 7);
  var dmgCount = 0, dmgValue = 0;
  mine.forEach(function (ev) {
    if ((ev.date || '').slice(0, 7) === month) {
      dmgCount += eventIssues(ev);
      dmgValue += eventDamageValue(ev);
    }
  });

  var html = '<div style="margin:6px 2px 4px">' +
    '<div style="font-size:20px;font-weight:800">' + greet + ', ' + esc(myName) + '!</div>' +
    '<div class="hint">' + fmtDate(td) + ' · Here\'s your day at a glance.</div>' +
    '</div>';

  html += '<div class="tiles">' +
    tile(String(todayEvents.length), 'My events today') +
    tile(String(pendTotal), 'Items to return', pendTotal > 0 ? 'bad' : '') +
    tile(String(dmgCount), 'Damaged/lost this month', dmgCount > 0 ? 'bad' : '') +
    tile(money(dmgValue), 'Damage value', dmgValue > 0 ? 'bad' : '') +
    '</div>';

  if (pendTotal === 0 && dmgCount === 0) {
    html += '<div class="notice green">Cleared — no pending items or damages this month. Keep it up!</div>';
  }

  html += '<div class="section-title">My Events Today</div>';
  html += todayEvents.length ? todayEvents.map(eventCard).join('') : '<div class="empty">No events assigned to you today.</div>';

  /* CHANGED: staff can see and search their own past events */
  html += '<div class="section-title">My Past Events</div>';
  html += '<input class="search" placeholder="Search my events…" value="' + esc(staffHomeSearch) + '" oninput="staffHomeSearch=this.value;refreshMyEvents()">';
  html += '<div id="myEventList">' + myEventsListHTML() + '</div>';

  return html;
}

/* CHANGED: searchable list of the logged-in staff's past events (closed or past-date) */
var staffHomeSearch = '';

function myEventsListHTML() {
  var myKey = currentUserName().toLowerCase();
  var td = today();
  var q = staffHomeSearch.trim().toLowerCase();
  var list = db.events.filter(function (ev) {
    if ((ev.lead || '').trim().toLowerCase() !== myKey) return false;
    var isOld = ev.status === 'closed' || (ev.date || '') < td;
    if (!isOld) return false;
    if (!q) return true;
    return (ev.name || '').toLowerCase().indexOf(q) >= 0 ||
           (ev.venue || '').toLowerCase().indexOf(q) >= 0 ||
           (ev.date || '').indexOf(q) >= 0 ||
           fmtDate(ev.date).toLowerCase().indexOf(q) >= 0;
  });
  list.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  if (!list.length) return '<div class="empty">' + (q ? 'No matching events.' : 'No past events yet.') + '</div>';
  var html = list.slice(0, 30).map(eventCard).join('');
  if (list.length > 30) html += '<div class="hint" style="text-align:center">…and ' + (list.length - 30) + ' more</div>';
  return html;
}

function refreshMyEvents() {
  var el = document.getElementById('myEventList');
  if (el) el.innerHTML = myEventsListHTML();
}

/* ============================================================
   TAB: DATABASE
   ============================================================ */
function dbTabLabel(tab) {
  if (tab === 'event') return 'Event Items';
  if (tab === 'toolbox') return 'Toolbox';
  return 'Food';
}

function getMaterials(cat) {
  var set = {};
  db.items.forEach(function (it) {
    if (it.category === cat && it.material) set[it.material] = true;
  });
  return Object.keys(set).sort();
}

function dbTabItems(tab) {
  var q = dbSearch.trim().toLowerCase();
  return db.items.filter(function (it) {
    if (tab === 'event' && it.category !== 'event') return false;
    if (tab === 'food' && it.category !== 'food') return false;
    if (tab === 'toolbox') {
      if (it.category !== 'toolbox') return false;
      if (dbFilter === 'toolbox-n' && it.disposable) return false;
      if (dbFilter === 'toolbox-d' && !it.disposable) return false;
    }
    if ((tab === 'event' || tab === 'food') && dbMaterialFilter !== 'all' && (it.material || '') !== dbMaterialFilter) return false;
    if (q && it.name.toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort(byName);
}

function renderDatabase() {
  var tabs = ['event', 'toolbox', 'food'];
  var html = '<div class="chips" style="margin-bottom:10px">' + tabs.map(function (t) {
    return '<button class="chip' + (dbTab === t ? ' active' : '') +
      '" style="flex:1" onclick="dbTab=\'' + t + '\';dbFilter=\'all\';dbMaterialFilter=\'all\';render()">' + dbTabLabel(t) + '</button>';
  }).join('') + '</div>';

  html += '<input class="search" placeholder="Search for an item…" value="' + esc(dbSearch) + '" oninput="dbSearch=this.value;refreshDbList()">';

  if (dbTab === 'toolbox') {
    var subChips = [['all', 'All'], ['toolbox-n', 'Returnable'], ['toolbox-d', 'Disposable']];
    html += '<div class="chips">' + subChips.map(function (c) {
      return '<button class="chip' + (dbFilter === c[0] ? ' active' : '') + '" onclick="dbFilter=\'' + c[0] + '\';render()">' + c[1] + '</button>';
    }).join('') + '</div>';
  }

  if (dbTab === 'event' || dbTab === 'food') {
    var materials = getMaterials(dbTab);
    if (materials.length) {
      html += '<div class="chips">' +
        '<button class="chip' + (dbMaterialFilter === 'all' ? ' active' : '') + '" onclick="dbMaterialFilter=\'all\';render()">All</button>' +
        materials.map(function (m) {
          return '<button class="chip' + (dbMaterialFilter === m ? ' active' : '') + '" onclick="dbMaterialFilter=\'' + esc(m) + '\';render()">' + esc(m) + '</button>';
        }).join('') +
        '</div>';
    }
  }

  html += '<div id="dbList">' + dbListHTML(dbTabItems(dbTab)) + '</div>';
  html += '<button onclick="openItemForm(null,\'' + dbTab + '\')" title="Add Item to ' + dbTabLabel(dbTab) + '" style="position:fixed;bottom:calc(96px + env(safe-area-inset-bottom));right:20px;width:56px;height:56px;border-radius:50%;background:#1a7f5a;color:#fff;border:none;font-size:28px;box-shadow:0 4px 10px rgba(0,0,0,0.3);cursor:pointer;z-index:80;display:flex;align-items:center;justify-content:center;line-height:1">＋</button>';
  return html;
}

function dbListHTML(items) {
  if (!items.length) return '<div class="empty">No items. Tap "＋" to add one.</div>';
  return items.map(function (it) { return itemCard(it); }).join('');
}

function refreshDbList() {
  var el = document.getElementById('dbList');
  if (!el) return;
  el.innerHTML = dbListHTML(dbTabItems(dbTab));
}

function itemCard(it) {
  var avail = availableNow(it);
  var low = isConsumable(it) && it.reorderPoint > 0 && avail <= it.reorderPoint;
  var out = !isConsumable(it) ? pendingOut(it.id) : 0;
  var meta = (it.material ? esc(it.material) + ' · ' : '') + catLabel(it) + ' · ' + money(it.price) + '/' + esc(it.unit);
  var right;
  if (isConsumable(it)) {
    right = '<div class="stat-num" style="' + (low ? 'color:var(--red)' : '') + '">' + avail + ' ' + esc(it.unit) + '</div>' +
            '<div class="stat-label">' + (low ? 'Reorder now!' : 'stock') + '</div>';
  } else {
    /* CHANGED: show avail vs ORIGINAL owned (e.g. 18/20), and mark Incomplete in red if may damaged/lost */
    var dl = totalDamagedLost(it.id);
    var statusLabel;
    if (out > 0) {
      statusLabel = out + ' out' + (dl > 0 ? ' · Incomplete' : '');
    } else if (dl > 0) {
      statusLabel = 'Incomplete';
    } else {
      statusLabel = 'complete';
    }
    right = '<div class="stat-num"' + (dl > 0 ? ' style="color:var(--red)"' : '') + '>' + avail + '/' + (it.owned || 0) + '</div>' +
            '<div class="stat-label"' + (dl > 0 ? ' style="color:var(--red);font-weight:600"' : '') + '>' + statusLabel + '</div>';
  }
  return '<div class="card tappable" onclick="openItemForm(\'' + it.id + '\')"><div class="row">' +
    photoThumb(it) +
    '<div class="grow"><div class="item-name">' + esc(it.name) + '</div><div class="item-meta">' + meta + '</div></div>' +
    '<div>' + right + '</div>' +
    '</div></div>';
}

/* CHANGED: item photos now live in their own cloud collection ('photos'),
   one document per item — this removes the 1MB limit risk on the main data */
var PHOTOS = {};

function itemPhotoSrc(it) {
  if (!it) return null;
  if (it.photo) return it.photo;                 /* legacy: photo still inside main data */
  if (it.hasPhoto && PHOTOS[it.id]) return PHOTOS[it.id];
  return null;
}

function photoThumb(it) {
  var src = itemPhotoSrc(it);
  if (src) return '<img class="thumb" src="' + src + '" alt="">';
  return '<div class="thumb">' + catIcon(it) + '</div>';
}

function openItemForm(id, presetTab) {
  var it = id ? getItem(id) : null;
  photoTemp = it ? itemPhotoSrc(it) : null;
  var consumable = it ? isConsumable(it) : (presetTab === 'food');
  var presetCat = it ? null : (presetTab === 'toolbox' ? 'toolbox-n' : presetTab || 'event');
  /* CHANGED: when adding from the Toolbox tab, only show Returnable and Disposable options */
  var toolboxOnly = (!it && presetTab === 'toolbox');
  var catOptions;
  if (toolboxOnly) {
    catOptions =
      opt('toolbox-n', 'Returnable (serving)', true) +
      opt('toolbox-d', 'Disposable (runs out)', false);
  } else {
    catOptions =
      opt('event', 'Event Item (returnable)', it ? it.category === 'event' : presetCat === 'event') +
      opt('toolbox-n', 'Toolbox — Returnable (serving)', it ? (it.category === 'toolbox' && !it.disposable) : presetCat === 'toolbox-n') +
      opt('toolbox-d', 'Toolbox — Disposable (runs out)', it ? (it.category === 'toolbox' && it.disposable) : false) +
      opt('food', 'Food / Storage', it ? it.category === 'food' : presetCat === 'food');
  }
  var html = '<h3>' + (it ? 'Edit Item' : 'New Item') + '</h3>' +
    '<div class="photo-box" onclick="capturePhoto(function(d){photoTemp=d;refreshFormPhoto()})">' +
      '<div id="formPhoto">' + formPhotoHTML() + '</div>' +
      '<div class="photo-hint">' + (photoTemp ? 'Change' : 'Take a photo') + '</div>' +
    '</div>' +
    '<div class="field"><label>Item Name</label><input id="f_name" value="' + esc(it ? it.name : '') + '" placeholder="e.g. Chafing Dish"></div>' +
    /* CHANGED: hide the material/type text field for toolbox items — it's only used by Event Items and Food */
    (toolboxOnly ? '' : '<div class="field"><label>Category/Type (optional)</label><input id="f_material" value="' + esc(it ? (it.material || '') : '') + '" placeholder="e.g. Wood, Metal, Meat, Fruits, Vegetables"></div>') +
    '<div class="field"><label>' + (toolboxOnly ? 'Type' : 'Category') + '</label><select id="f_cat" onchange="itemFormToggle()">' +
      catOptions +
    '</select></div>' +
    '<div class="field-row">' +
      '<div class="field"><label>Unit</label><input id="f_unit" value="' + esc(it ? it.unit : 'pcs') + '" placeholder="pcs / kg / L"></div>' +
      '<div class="field"><label>Price per unit (' + PESO + ')</label><input id="f_price" type="number" inputmode="decimal" min="0" step="any" value="' + (it ? it.price : '') + '" placeholder="0"></div>' +
    '</div>' +
    '<div class="field-row" id="f_nonconsRow" ' + (consumable ? 'style="display:none"' : '') + '>' +
      '<div class="field"><label>Quantity owned</label><input id="f_owned" type="number" inputmode="numeric" min="0" value="' + (it ? it.owned : '') + '" placeholder="0"></div>' +
    '</div>' +
    '<div class="field-row" id="f_consRow" ' + (consumable ? '' : 'style="display:none"') + '>' +
      '<div class="field"><label>Current stock</label><input id="f_stock" type="number" inputmode="decimal" min="0" step="any" value="' + (it ? it.stock : '') + '" placeholder="0"></div>' +
      '<div class="field"><label>Reorder point</label><input id="f_reorder" type="number" inputmode="decimal" min="0" step="any" value="' + (it ? it.reorderPoint : '') + '" placeholder="0"></div>' +
    '</div>' +
    '<div class="btn-row">' +
      (it ? '<button class="btn btn-danger" onclick="deleteItem(\'' + it.id + '\')">Delete</button>' : '') +
      '<button class="btn btn-primary" onclick="saveItemForm(' + (it ? '\'' + it.id + '\'' : 'null') + ')">Save</button>' +
    '</div>';
  openModal(html);
}

function opt(v, label, sel) { return '<option value="' + v + '"' + (sel ? ' selected' : '') + '>' + label + '</option>'; }

function formPhotoHTML() {
  if (photoTemp) return '<img class="thumb-lg" src="' + photoTemp + '" alt="">';
  return '<div class="thumb-lg">' + svgIcon('camera', 34) + '</div>';
}
function refreshFormPhoto() {
  var el = document.getElementById('formPhoto');
  if (el) el.innerHTML = formPhotoHTML();
}
function itemFormToggle() {
  var cat = document.getElementById('f_cat').value;
  var consumable = (cat === 'food' || cat === 'toolbox-d');
  document.getElementById('f_nonconsRow').style.display = consumable ? 'none' : '';
  document.getElementById('f_consRow').style.display = consumable ? '' : 'none';
}

function saveItemForm(id) {
  var name = document.getElementById('f_name').value.trim();
  if (!name) { alert('Enter the item name.'); return; }
  var cat = document.getElementById('f_cat').value;
  var it = id ? getItem(id) : null;
  if (!it) { it = { id: uid(), photo: null, notes: '' }; db.items.push(it); }
  it.name = name;
  /* CHANGED: material field may be hidden (toolbox form), so check it exists first */
  var matEl = document.getElementById('f_material');
  it.material = matEl ? matEl.value.trim() : (it.material || '');
  it.category = (cat === 'food') ? 'food' : (cat === 'event') ? 'event' : 'toolbox';
  it.disposable = (cat === 'toolbox-d');
  it.unit = document.getElementById('f_unit').value.trim() || 'pcs';
  it.price = num(document.getElementById('f_price').value);
  it.owned = Math.round(num(document.getElementById('f_owned').value));
  it.stock = num(document.getElementById('f_stock').value);
  it.reorderPoint = num(document.getElementById('f_reorder').value);
  /* CHANGED: photos are saved in their own cloud collection, not the main data doc */
  if (photoTemp) {
    if (PHOTOS[it.id] !== photoTemp) {
      PHOTOS[it.id] = photoTemp;
      if (fsDB) fsDB.collection('photos').doc(it.id).set({ data: photoTemp }).catch(function (e) {
        console.error('Photo save error', e);
        toast('Photo not synced — check internet.');
      });
    }
    it.hasPhoto = true;
    it.photo = null;
  } else {
    if (it.hasPhoto && fsDB) fsDB.collection('photos').doc(it.id).delete().catch(function () {});
    delete PHOTOS[it.id];
    it.hasPhoto = false;
    it.photo = null;
  }
  logAction((id ? 'Edited item: ' : '➕ Added item: ') + name);
  saveDB(); closeModal(); render();
  toast('Saved: ' + name);
}

function deleteItem(id) {
  var it = getItem(id);
  if (!it) return;
  var used = db.events.some(function (ev) {
    return (ev.lines || []).some(function (l) { return l.itemId === id; }) ||
           (ev.usage || []).some(function (u) { return u.itemId === id; });
  });
  var msg = used
    ? '"' + it.name + '" has already been used in event records. Deleting it will remove it from the lists. Continue?'
    : 'Delete "' + it.name + '"?';
  if (!confirm(msg)) return;
  db.items = db.items.filter(function (x) { return x.id !== id; });
  /* CHANGED: also delete the item's photo from the photos collection */
  if (fsDB) fsDB.collection('photos').doc(id).delete().catch(function () {});
  delete PHOTOS[id];
  logAction('Deleted item: ' + it.name);
  saveDB(); closeModal(); render();
  toast('Deleted: ' + it.name);
}

/* ============================================================
   TAB: EVENTS
   ============================================================ */
var eventSearch = '';

function renderEvents() {
  /* CHANGED: search now refreshes only the list (not the whole page),
     so the search box keeps focus and the keyboard stays open while typing */
  var html = '<input class="search" placeholder="Search by event, lead, or venue…" value="' + esc(eventSearch) + '" oninput="eventSearch=this.value;refreshEventList()">';
  html += '<div id="eventList">' + eventListHTML() + '</div>';
  html += '<button onclick="openEventForm()" title="New Event" style="position:fixed;bottom:calc(96px + env(safe-area-inset-bottom));right:20px;width:56px;height:56px;border-radius:50%;background:#1a7f5a;color:#fff;border:none;font-size:28px;box-shadow:0 4px 10px rgba(0,0,0,0.3);cursor:pointer;z-index:80;display:flex;align-items:center;justify-content:center;line-height:1">＋</button>';
  return html;
}

function eventListHTML() {
  var q = eventSearch.trim().toLowerCase();
  var matches = function (ev) {
    if (!q) return true;
    return (ev.name || '').toLowerCase().indexOf(q) >= 0 ||
           (ev.lead || '').toLowerCase().indexOf(q) >= 0 ||
           (ev.venue || '').toLowerCase().indexOf(q) >= 0;
  };
  /* CHANGED: staff only see events where they are the lead or the checker.
     Admin sees everything. */
  var pool = db.events;
  if (!isAdmin()) {
    var myKey = currentUserName().toLowerCase();
    pool = pool.filter(function (ev) {
      return (ev.lead || '').trim().toLowerCase() === myKey ||
             (ev.checker || '').trim().toLowerCase() === myKey;
    });
  }
  var open = pool.filter(function (e) { return e.status === 'open' && matches(e); });
  var closed = pool.filter(function (e) { return e.status === 'closed' && matches(e); });
  closed.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });

  /* CHANGED: open events are now split into "Today & Upcoming" (soonest first)
     and "Still Open — past dates" (events that should probably be closed) */
  var td = today();
  var upcoming = open.filter(function (e) { return (e.date || '') >= td; })
    .sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
  var pastOpen = open.filter(function (e) { return (e.date || '') < td; })
    .sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });

  var html = '<div class="section-title">Today & Upcoming (' + upcoming.length + ')</div>';
  html += upcoming.length ? upcoming.map(eventCard).join('') : '<div class="empty">No upcoming events.</div>';

  if (pastOpen.length) {
    html += '<div class="section-title">Still Open — past dates (' + pastOpen.length + ')</div>';
    html += pastOpen.map(eventCard).join('');
  }

  if (closed.length) {
    html += '<div class="section-title">Completed (' + closed.length + ')</div>';
    html += closed.slice(0, 20).map(eventCard).join('');
    if (closed.length > 20) html += '<div class="hint" style="text-align:center">…and ' + (closed.length - 20) + ' more</div>';
  } else if (q) {
    html += '<div class="empty">No matching events.</div>';
  }
  return html;
}

function refreshEventList() {
  var el = document.getElementById('eventList');
  if (el) el.innerHTML = eventListHTML();
}

function eventCard(ev) {
  var pend = eventPending(ev);
  var issues = eventIssues(ev);
  var badge;
  if (ev.status === 'closed') {
    badge = issues > 0 ? '<span class="badge b-amber">Closed · has damaged/lost items (' + money(eventDamageValue(ev)) + ')</span>' : '<span class="badge b-gray">Closed ✓</span>';
  } else {
    badge = pend > 0 ? '<span class="badge b-red">' + pend + ' not yet returned</span>' : '<span class="badge b-green">All returned</span>';
  }
  /* CHANGED: peso value removed from event cards — values are shown inside
     the event detail instead. Damage/lost badges stay visible. */
  if (ev.status === 'open' && ev.date === today()) badge = '<span class="badge b-green">TODAY</span> ' + badge;
  return '<div class="card tappable" onclick="go(\'eventDetail\',\'' + ev.id + '\')">' +
    '<div class="row"><div class="grow">' +
      '<div class="item-name">' + esc(ev.name) + '</div>' +
      '<div class="item-meta">Date: ' + fmtDate(ev.date) + (ev.venue ? ' · Venue: ' + esc(ev.venue) : '') + '</div>' +
      '<div class="item-meta">Lead: ' + esc(ev.lead || '—') + ' · Checker: ' + esc(ev.checker || '—') + '</div>' +
    '</div></div>' +
    '<div style="margin-top:8px">' + badge + '</div>' +
    '</div>';
}

function openEventForm(id) {
  var ev = id ? getEvent(id) : null;
  if (ev && !canEditRecord(ev.ts)) { alert('The 3-hour editing window for this event\'s details has passed. Ask an admin to make corrections.'); return; }
  var html = '<h3>' + (ev ? 'Edit Event' : 'New Event') + '</h3>' +
    '<div class="field"><label>Event / Client Name</label><input id="e_name" value="' + esc(ev ? ev.name : '') + '" placeholder="e.g. Santos Wedding"></div>' +
    '<div class="field-row">' +
      '<div class="field"><label>Date</label><input id="e_date" type="date" value="' + esc(ev ? ev.date : today()) + '"></div>' +
      '<div class="field"><label>Venue</label><input id="e_venue" value="' + esc(ev ? ev.venue : '') + '" placeholder="e.g. Tagaytay"></div>' +
    '</div>' +
    '<div class="field-row">' +
      '<div class="field"><label>Lead (in-charge of the event)</label><select id="e_lead">' + staffNameOptions(ev ? ev.lead : (isAdmin() ? '' : currentUserName())) + '</select></div>' +
      '<div class="field"><label>Checker (encoding)</label><input id="e_checker" value="' + esc(ev ? ev.checker : '') + '" placeholder="Name"></div>' +
    '</div>' +
    '<div class="btn-row"><button class="btn btn-primary btn-block" onclick="saveEventForm(' + (ev ? '\'' + ev.id + '\'' : 'null') + ')">Save</button></div>';
  openModal(html);
}

function saveEventForm(id) {
  var name = document.getElementById('e_name').value.trim();
  if (!name) { alert('Enter the event name.'); return; }
  var ev = id ? getEvent(id) : null;
  var isNew = !ev;
  if (!ev) { ev = { id: uid(), status: 'open', lines: [], usage: [], ts: Date.now() }; db.events.push(ev); }
  ev.name = name;
  ev.date = document.getElementById('e_date').value || today();
  ev.venue = document.getElementById('e_venue').value.trim();
  ev.lead = document.getElementById('e_lead').value.trim();
  ev.checker = document.getElementById('e_checker').value.trim();
  logAction((isNew ? '➕ Created event: ' : 'Edited event: ') + name);
  saveDB(); closeModal();
  if (isNew) go('eventDetail', ev.id); else render();
  toast('Event saved');
}

/* ---- event detail ---- */
function renderEventDetail(id) {
  var ev = getEvent(id);
  if (!ev) return '<div class="empty">Event not found.</div>';
  /* CHANGED: staff can only open events where they are the lead or the checker */
  if (!isAdmin()) {
    var myKey = currentUserName().toLowerCase();
    if ((ev.lead || '').trim().toLowerCase() !== myKey &&
        (ev.checker || '').trim().toLowerCase() !== myKey) {
      return '<button class="back-btn" onclick="go(\'events\')">← Back to Events</button>' +
        '<div class="empty">You can only view events where you are the lead or the checker.</div>';
    }
  }
  var closed = ev.status === 'closed';
  var pend = eventPending(ev);
  var issues = eventIssues(ev);
  var html = '<button class="back-btn" onclick="go(\'events\')">← Back to Events</button>';
  html += '<div class="card"><div class="row"><div class="grow">' +
    '<div class="item-name" style="font-size:17px">' + esc(ev.name) + '</div>' +
    '<div class="item-meta">Date: ' + fmtDate(ev.date) + (ev.venue ? ' · Venue: ' + esc(ev.venue) : '') + '</div>' +
    '<div class="item-meta">Lead: <b>' + esc(ev.lead || '—') + '</b> · Checker: <b>' + esc(ev.checker || '—') + '</b></div>' +
    '</div>' +
    (!closed ? (canEditRecord(ev.ts) ? '<button class="btn btn-sm" onclick="openEventForm(\'' + ev.id + '\')">' + svgIcon('edit', 14) + '</button>' : '') : '<span class="badge b-gray">CLOSED</span>') +
    '</div></div>';
  if (!closed && pend > 0) html += '<div class="notice red">' + pend + ' item(s) not yet returned.</div>';
  if (!closed && pend === 0 && (ev.lines || []).length) html += '<div class="notice green">All items returned. This event can now be closed.</div>';
  if (closed && issues > 0) html += '<div class="notice amber">' + issues + ' item(s) damaged or lost in this event (' + money(eventDamageValue(ev)) + ').</div>';
  html += '<div class="tiles">' +
    tile(money(eventValueOut(ev)), 'Value of items released') +
    tile(money(eventUsageCost(ev, 'food')), 'Food expenses') +
    '</div>';
  html += '<div class="section-title">Items Released (returnable)</div>';
  /* CHANGED: live search so the checker can find an item to Return without
     scrolling through the whole list */
  if (window._evSearchFor !== ev.id) { eventItemSearch = ''; window._evSearchFor = ev.id; }
  if ((ev.lines || []).length > 0) {
    html += '<input class="search" placeholder="Search released item…" value="' + esc(eventItemSearch) + '" oninput="eventItemSearch=this.value;refreshEvLines()">';
  }
  html += '<div id="evLinesList">' + evLinesHTML(ev, closed) + '</div>';
  if (!closed) html += '<div style="margin:6px 0 14px;text-align:center"><button class="btn btn-sm btn-primary" onclick="openReleasePicker(\'' + ev.id + '\')">＋ Release Item</button></div>';

  html += '<div class="section-title">Disposables Used</div>';
  html += usageList(ev, 'toolbox', closed);
  if (!closed) html += '<div style="margin:6px 0 14px;text-align:center"><button class="btn btn-sm btn-primary" onclick="openUsagePicker(\'' + ev.id + '\',\'toolbox\')">＋ Use Disposable</button></div>';

  html += '<div class="section-title">Food Used</div>';
  html += usageList(ev, 'food', closed);
  if (!closed) html += '<div style="margin:6px 0 14px;text-align:center"><button class="btn btn-sm btn-primary" onclick="openUsagePicker(\'' + ev.id + '\',\'food\')">＋ Use Food</button></div>';

  if (!closed) {
    html += '<div class="event-actions"><div class="btn-row">' +
      (isAdmin() ? '<button class="btn btn-danger" onclick="deleteEvent(\'' + ev.id + '\')">Delete</button>' : '') +
      /* CHANGED: Save button — everything saves automatically, but this gives
         checkers a clear "done encoding" action that is NOT Close Event */
      '<button class="btn btn-soft" onclick="saveAndExitEvent()">Save</button>' +
      '<button class="btn btn-primary" onclick="closeEvent(\'' + ev.id + '\')">Close Event</button>' +
    '</div>' +
    '<div class="hint" style="text-align:center;margin-top:6px">Save = keep encoding later. Close Event = the event is finished and all items are accounted for.</div></div>' +
    /* CHANGED: spacer so the last cards can scroll above the fixed bar */
    '<div style="height:120px"></div>';
  } else if (isAdmin()) {
    html += '<div class="btn-row" style="margin-top:16px">' +
      '<button class="btn btn-danger" onclick="deleteEvent(\'' + ev.id + '\')">Delete This Event</button>' +
    '</div>';
    html += '<div class="hint" style="text-align:center;margin-top:6px">Use this if the event was closed by mistake or needs to be removed entirely.</div>';
  }
  return html;
}

function tile(numStr, label, cls) {
  return '<div class="tile ' + (cls || '') + '"><div class="t-num">' + numStr + '</div><div class="t-label">' + label + '</div></div>';
}

function usageList(ev, category, closed) {
  var rows = (ev.usage || []).map(function (u, idx) { return { u: u, idx: idx }; })
    .filter(function (r) { var it = getItem(r.u.itemId); return it && it.category === category; });
  if (!rows.length) return '<div class="empty">None yet.</div>';
  return rows.map(function (r) {
    var it = getItem(r.u.itemId);
    var cost = (r.u.qty || 0) * (r.u.cost != null ? r.u.cost : (it.price || 0));
    return '<div class="card"><div class="row">' + photoThumb(it) +
      '<div class="grow"><div class="item-name">' + esc(it.name) + '</div>' +
      '<div class="item-meta">' + r.u.qty + ' ' + esc(it.unit) + ' · ' + money(cost) + '</div></div>' +
      (!closed && canEditRecord(r.u.ts) ? '<button class="btn btn-sm" onclick="editUsage(\'' + ev.id + '\',' + r.idx + ')">' + svgIcon('edit', 14) + '</button>' : '') +
      '</div></div>';
  }).join('');
}

function openReleasePicker(evId) {
  openPicker(
    function (it) { return !isConsumable(it); },
    function (item) { openReleaseQty(evId, item.id); },
    'Select item to release'
  );
}

function openReleaseQty(evId, itemId) {
  var it = getItem(itemId);
  var avail = availableNow(it);
  var html = '<h3>Release: ' + esc(it.name) + '</h3>' +
    '<div class="hint" style="margin-bottom:10px">Available now: <b>' + avail + '</b> of ' + ownedEffective(it) + ' ' + esc(it.unit) + '</div>' +
    '<div class="field"><label>How many ' + esc(it.unit) + ' to release?</label><input id="r_qty" type="number" inputmode="numeric" min="1" placeholder="0" autofocus></div>' +
    '<div class="btn-row"><button class="btn btn-primary btn-block" onclick="doRelease(\'' + evId + '\',\'' + itemId + '\')">Save Release</button></div>';
  openModal(html);
}

function doRelease(evId, itemId) {
  var ev = getEvent(evId); var it = getItem(itemId);
  if (!ev || !it) return;
  var qty = Math.round(num(document.getElementById('r_qty').value));
  if (qty <= 0) { alert('Enter how many to release.'); return; }
  var avail = availableNow(it);
  if (qty > avail && !confirm('Warning: only ' + avail + ' ' + it.name + ' available. Proceed with ' + qty + ' anyway?')) return;
  var notes = '';
  var line = null;
  (ev.lines || []).forEach(function (l) { if (l.itemId === itemId) line = l; });
  if (line) {
    line.out += qty;
    line.ts = Date.now();
    if (notes) line.notes = (line.notes ? line.notes + '; ' : '') + notes;
  } else {
    ev.lines.push({ itemId: itemId, out: qty, returned: 0, damaged: 0, lost: 0, notes: notes, ts: Date.now() });
  }
  logAction('Released ' + qty + ' ' + it.name + ' — ' + ev.name);
  saveDB(); closeModal(); render();
  toast('Released: ' + qty + ' ' + it.name);
}

function openReturnForm(evId, lineIdx) {
  var ev = getEvent(evId); var l = ev.lines[lineIdx];
  var it = getItem(l.itemId);
  var p = linePending(l);
  var html = '<h3>Return: ' + esc(it ? it.name : '') + '</h3>' +
    '<div class="hint" style="margin-bottom:10px">Released: <b>' + l.out + '</b> · Already returned: <b>' + (l.returned || 0) + '</b> · Pending: <b style="color:var(--red)">' + p + '</b></div>' +
    '<div class="field"><label>How many returned in good condition?</label><input id="rt_ok" type="number" inputmode="numeric" min="0" max="' + p + '" value="' + p + '"></div>' +
    '<div class="field"><label>How many damaged / broken?</label><input id="rt_dmg" type="number" inputmode="numeric" min="0" max="' + p + '" value="0"></div>' +
    '<div class="field"><label>Notes (optional)</label><input id="rt_notes" placeholder="e.g. lid cracked"></div>' +
    '<div class="btn-row"><button class="btn btn-primary btn-block" onclick="doReturn(\'' + evId + '\',' + lineIdx + ')">Save Return</button></div>';
  openModal(html);
}

function doReturn(evId, lineIdx) {
  var ev = getEvent(evId); var l = ev.lines[lineIdx];
  var it = getItem(l.itemId);
  var p = linePending(l);
  var ok = Math.round(num(document.getElementById('rt_ok').value));
  var dmg = Math.round(num(document.getElementById('rt_dmg').value));
  if (ok < 0 || dmg < 0) return;
  if (ok + dmg > p) { alert('Too many! Only ' + p + ' pending items can be returned.'); return; }
  if (ok + dmg === 0) { alert('Enter how many were returned or damaged.'); return; }
  l.returned = (l.returned || 0) + ok;
  l.damaged = (l.damaged || 0) + dmg;
  var notes = document.getElementById('rt_notes').value.trim();
  if (notes) l.notes = (l.notes ? l.notes + '; ' : '') + notes;
  logAction('Returned ' + ok + (dmg ? ' + ' + dmg + ' damaged' : '') + ' ' + (it ? it.name : '?') + ' — ' + ev.name);
  saveDB(); closeModal(); render();
  toast('Returned: ' + ok + (dmg ? ' · Damaged: ' + dmg : '') + ' — ' + (it ? it.name : ''));
}

/* CHANGED: edit a released line — correct a wrongly-encoded OUT quantity,
   or remove the line entirely if nothing has been returned/damaged yet */
function openEditRelease(evId, lineIdx) {
  var ev = getEvent(evId); var l = ev.lines[lineIdx];
  if (!canEditRecord(l.ts)) { alert('The 3-hour editing window for this entry has passed. Ask an admin to make corrections.'); return; }
  var it = getItem(l.itemId);
  var minOut = (l.returned || 0) + (l.damaged || 0) + (l.lost || 0);
  var html = '<h3>Edit Release: ' + esc(it ? it.name : '') + '</h3>' +
    '<div class="hint" style="margin-bottom:10px">Recorded OUT: <b>' + l.out + '</b> · Returned: <b>' + (l.returned || 0) + '</b> · Damaged/Lost: <b>' + ((l.damaged || 0) + (l.lost || 0)) + '</b><br>If the released quantity was encoded wrong, correct it here.</div>' +
    '<div class="field"><label>Correct quantity released (OUT)</label><input id="er_out" type="number" inputmode="numeric" min="' + minOut + '" value="' + l.out + '"></div>' +
    (minOut > 0 ? '<div class="hint" style="margin-bottom:10px">Cannot go below ' + minOut + ' — that many were already returned or marked damaged/lost.</div>' : '') +
    '<div class="btn-row">' +
      (minOut === 0 ? '<button class="btn btn-danger" onclick="saveEditRelease(\'' + evId + '\',' + lineIdx + ',true)">Remove</button>' : '') +
      '<button class="btn btn-primary" onclick="saveEditRelease(\'' + evId + '\',' + lineIdx + ',false)">Save</button>' +
    '</div>';
  openModal(html);
}

function saveEditRelease(evId, lineIdx, remove) {
  var ev = getEvent(evId); var l = ev.lines[lineIdx];
  var it = getItem(l.itemId);
  var minOut = (l.returned || 0) + (l.damaged || 0) + (l.lost || 0);
  if (remove) {
    if (minOut > 0) { alert('Cannot remove: some items were already returned or marked damaged/lost.'); return; }
    if (!confirm('Remove ' + (it ? it.name : 'this item') + ' from this event\'s released items?')) return;
    ev.lines.splice(lineIdx, 1);
  } else {
    var newOut = Math.round(num(document.getElementById('er_out').value));
    if (newOut < minOut) { alert('OUT cannot be less than ' + minOut + ' — that many were already returned or marked damaged/lost.'); return; }
    if (newOut === 0) {
      ev.lines.splice(lineIdx, 1);
    } else {
      l.out = newOut;
    }
  }
  logAction('' + (remove ? 'Removed released item ' : 'Edited release of ') + (it ? it.name : '?') + ' — ' + ev.name);
  saveDB(); closeModal(); render();
  toast('Release updated' + (it ? ': ' + it.name : ''));
}

function openUsagePicker(evId, category) {
  openPicker(
    function (it) { return isConsumable(it) && it.category === category; },
    function (item) { openUsageQty(evId, item.id); },
    category === 'food' ? 'Select food used' : 'Select disposable used'
  );
}

function openUsageQty(evId, itemId) {
  var it = getItem(itemId);
  var html = '<h3>Use: ' + esc(it.name) + '</h3>' +
    '<div class="hint" style="margin-bottom:10px">Current stock: <b>' + (it.stock || 0) + ' ' + esc(it.unit) + '</b></div>' +
    '<div class="field"><label>How many ' + esc(it.unit) + ' were used?</label><input id="u_qty" type="number" inputmode="decimal" min="0" step="any" placeholder="0" autofocus></div>' +
    '<div class="btn-row"><button class="btn btn-primary btn-block" onclick="doUsage(\'' + evId + '\',\'' + itemId + '\')">Save</button></div>';
  openModal(html);
}

function doUsage(evId, itemId) {
  var ev = getEvent(evId); var it = getItem(itemId);
  if (!ev || !it) return;
  var qty = num(document.getElementById('u_qty').value);
  if (qty <= 0) { alert('Enter how many were used.'); return; }
  if (qty > (it.stock || 0) && !confirm('Warning: only ' + (it.stock || 0) + ' ' + it.unit + ' of ' + it.name + ' in stock. Proceed anyway?')) return;
  var u = null;
  (ev.usage || []).forEach(function (x) { if (x.itemId === itemId) u = x; });
  if (u) { u.qty += qty; u.ts = Date.now(); }
  else { ev.usage.push({ itemId: itemId, qty: qty, cost: it.price || 0, ts: Date.now() }); }
  it.stock = Math.max(0, (it.stock || 0) - qty);
  logAction('Used ' + qty + ' ' + it.unit + ' ' + it.name + ' — ' + ev.name);
  saveDB(); closeModal(); render();
  var low = it.reorderPoint > 0 && it.stock <= it.reorderPoint;
  toast('Used: ' + qty + ' ' + it.unit + ' ' + it.name + (low ? ' — stock running low!' : ''));
}

function editUsage(evId, usageIdx) {
  var ev = getEvent(evId); var u = ev.usage[usageIdx];
  if (!canEditRecord(u.ts)) { alert('The 3-hour editing window for this entry has passed. Ask an admin to make corrections.'); return; }
  var it = getItem(u.itemId);
  var html = '<h3>Edit: ' + esc(it.name) + '</h3>' +
    '<div class="hint" style="margin-bottom:10px">Recorded: <b>' + u.qty + ' ' + esc(it.unit) + '</b>. If you reduce this, the difference is returned to stock (e.g. it wasn\'t actually used).</div>' +
    '<div class="field"><label>Correct quantity used</label><input id="ue_qty" type="number" inputmode="decimal" min="0" step="any" value="' + u.qty + '"></div>' +
    '<div class="btn-row">' +
      '<button class="btn btn-danger" onclick="saveUsageEdit(\'' + evId + '\',' + usageIdx + ',true)">Remove</button>' +
      '<button class="btn btn-primary" onclick="saveUsageEdit(\'' + evId + '\',' + usageIdx + ',false)">Save</button>' +
    '</div>';
  openModal(html);
}

function saveUsageEdit(evId, usageIdx, remove) {
  var ev = getEvent(evId); var u = ev.usage[usageIdx];
  var it = getItem(u.itemId);
  var newQty = remove ? 0 : num(document.getElementById('ue_qty').value);
  if (newQty < 0) return;
  var diff = u.qty - newQty;
  if (it) it.stock = Math.max(0, (it.stock || 0) + diff);
  if (newQty === 0) ev.usage.splice(usageIdx, 1);
  else u.qty = newQty;
  logAction('Edited usage of ' + (it ? it.name : '?') + ' — ' + ev.name);
  saveDB(); closeModal(); render();
  toast('Updated');
}

/* CHANGED: searchable released-items list — keeps the original line index so
   Return/Edit buttons still point to the right record even when filtered */
var eventItemSearch = '';

function evLinesHTML(ev, closed) {
  var lines = ev.lines || [];
  if (!lines.length) return '<div class="empty">No items released yet.</div>';
  var q = eventItemSearch.trim().toLowerCase();
  var html = '';
  var shown = 0;
  lines.forEach(function (l, idx) {
    var it = getItem(l.itemId);
    var name2 = it ? it.name : '(item deleted)';
    if (q && name2.toLowerCase().indexOf(q) < 0) return;
    shown++;
    var p = linePending(l);
    html += '<div class="card">' +
      '<div class="row">' + (it ? photoThumb(it) : '<div class="thumb">?</div>') +
      '<div class="grow"><div class="item-name">' + esc(name2) + '</div>' +
      (l.notes ? '<div class="item-meta">' + esc(l.notes) + '</div>' : '') + '</div>' +
      (!closed ? (canEditRecord(l.ts) ? '<button class="btn btn-sm" style="margin-right:6px" onclick="openEditRelease(\'' + ev.id + '\',' + idx + ')" title="Edit released quantity">' + svgIcon('edit', 14) + '</button>' : '') +
                 '<button class="btn btn-sm btn-primary" onclick="openReturnForm(\'' + ev.id + '\',' + idx + ')">Return</button>' : '') +
      '</div>' +
      '<div class="line-grid">' +
        '<div><div class="lg-num">' + l.out + '</div><div class="lg-label">OUT</div></div>' +
        '<div><div class="lg-num">' + (l.returned || 0) + '</div><div class="lg-label">RETURNED</div></div>' +
        '<div><div class="lg-num">' + ((l.damaged || 0) + (l.lost || 0)) + '</div><div class="lg-label">DAMAGED/LOST</div></div>' +
        '<div class="' + (p > 0 ? 'pend' : 'ok') + '"><div class="lg-num">' + p + '</div><div class="lg-label">PENDING</div></div>' +
      '</div></div>';
  });
  if (q && !shown) return '<div class="empty">No released item matches "' + esc(eventItemSearch) + '".</div>';
  return html;
}

function refreshEvLines() {
  var ev = getEvent(route.eventId);
  var el = document.getElementById('evLinesList');
  if (ev && el) el.innerHTML = evLinesHTML(ev, ev.status === 'closed');
}

/* CHANGED: reassurance save — data already auto-saves on every action, but
   this gives an explicit "done for now" button so no one taps Close Event
   just to save their encoding */
function saveAndExitEvent() {
  saveDB();
  toast('Saved — you can come back to this event anytime');
  go('events');
}

/* CHANGED: admin-only full reset — deletes ALL event records so every item
   automatically becomes available again (availability and damage totals are
   computed from event records). Items, food, deliveries, and logs stay. */
function resetAllEvents() {
  if (!isAdmin()) return;
  var count = db.events.length;
  if (!count) { toast('No event records to clear'); return; }
  if (!confirm('RESET ALL EVENT RECORDS?\n\nThis will permanently delete all ' + count + ' event record(s), including damage/lost history and staff records. Every item will return to its full owned quantity.\n\nItems, food, deliveries, and the activity log will NOT be deleted.\n\nTip: use Export Backup first if you want a copy.')) return;
  var word = prompt('Final check — type RESET (all capital letters) to continue:');
  if (word !== 'RESET') {
    if (word !== null) alert('Reset cancelled — you did not type RESET.');
    return;
  }
  db.events = [];
  logAction('RESET: cleared all event records (' + count + ')');
  saveDB();
  closeModal();
  go('home');
  toast('All event records cleared — all items are back to full quantity');
}

function closeEvent(evId) {
  var ev = getEvent(evId);
  var pend = eventPending(ev);
  if (pend > 0) {
    if (!confirm('There are still ' + pend + ' item(s) NOT returned. Closing this will mark them as LOST and deduct them from inventory, and it will show up in the record of lead ' + (ev.lead || '—') + '. Continue?')) return;
    (ev.lines || []).forEach(function (l) {
      var p = linePending(l);
      if (p > 0) l.lost = (l.lost || 0) + p;
    });
  } else {
    if (!confirm('Close this event? It cannot be edited afterward.')) return;
  }
  ev.status = 'closed';
  ev.closedAt = today();
  logAction('Closed event: ' + ev.name + (pend > 0 ? ' (' + pend + ' item(s) marked LOST)' : ''));
  saveDB(); render();
  toast('Event closed');
}

function deleteEvent(evId) {
  var ev = getEvent(evId);
  if (!confirm('Delete event "' + ev.name + '"? Recorded consumables used will be returned to stock.')) return;
  (ev.usage || []).forEach(function (u) {
    var it = getItem(u.itemId);
    if (it) it.stock = (it.stock || 0) + u.qty;
  });
  db.events = db.events.filter(function (e) { return e.id !== evId; });
  logAction('Deleted event: ' + ev.name);
  saveDB(); go('events');
  toast('Event deleted');
}

/* ============================================================
   TAB: TOOLBOX
   ============================================================ */
function renderToolbox() {
  var items = db.items.filter(function (it) { return it.category === 'toolbox'; });
  items.sort(byName);
  var lowCount = items.filter(function (it) { return it.disposable && isLow(it); }).length;

  var html = '<div class="tiles">' +
    tile(String(items.length), 'Toolbox items') +
    tile(String(lowCount), 'Need reordering', lowCount ? 'bad' : '') +
    '</div>';

  html += '<div class="section-title">Toolbox</div>';
  if (!items.length) html += '<div class="empty">No toolbox items yet. Add one in the Database tab.</div>';

  items.forEach(function (it) {
    if (it.disposable) {
      var low = isLow(it);
      html += '<div class="card"><div class="row">' + photoThumb(it) +
        '<div class="grow"><div class="item-name">' + esc(it.name) + '</div>' +
        '<div class="item-meta">Disposable · Reorder point: ' + (it.reorderPoint || 0) + ' ' + esc(it.unit) + '</div>' +
        (low ? '<span class="badge b-red">Reorder now!</span>' : '<span class="badge b-green">Stock OK</span>') +
        '</div>' +
        '<div><div class="stat-num"' + (low ? ' style="color:var(--red)"' : '') + '>' + (it.stock || 0) + '</div><div class="stat-label">' + esc(it.unit) + '</div>' +
        '<button class="btn btn-sm btn-primary" style="margin-top:6px" onclick="openDeliveryForm(\'' + it.id + '\')">＋ Delivery</button></div>' +
        '</div></div>';
    } else {
      /* CHANGED: show avail vs ORIGINAL owned + Incomplete status if may damaged/lost */
      var out = pendingOut(it.id);
      var dl = totalDamagedLost(it.id);
      var statusText;
      if (out > 0) statusText = '' + out + ' currently out (at an event)';
      else if (dl > 0) statusText = '' + dl + ' damaged/lost — Incomplete';
      else statusText = 'Complete in storage';
      html += '<div class="card tappable" onclick="openItemForm(\'' + it.id + '\')"><div class="row">' + photoThumb(it) +
        '<div class="grow"><div class="item-name">' + esc(it.name) + '</div>' +
        '<div class="item-meta">Returnable · ' + statusText + '</div></div>' +
        '<div><div class="stat-num"' + (dl > 0 ? ' style="color:var(--red)"' : '') + '>' + availableNow(it) + '/' + (it.owned || 0) + '</div><div class="stat-label"' + (dl > 0 ? ' style="color:var(--red);font-weight:600"' : '') + '>' + (dl > 0 ? 'Incomplete' : 'available') + '</div></div>' +
        '</div></div>';
    }
  });

  html += '<div class="hint" style="margin:4px 2px 14px">Releasing/returning returnable items is done inside each <b>Event</b>. Disposables are restocked via "＋ Delivery".</div>';
  return html;
}

function byName(a, b) { return a.name.localeCompare(b.name); }
function isLow(it) { return it.reorderPoint > 0 && (it.stock || 0) <= it.reorderPoint; }

/* ============================================================
   TAB: FOOD
   ============================================================ */
function renderFood() {
  var allFoods = db.items.filter(function (it) { return it.category === 'food'; });
  var lowCount = allFoods.filter(isLow).length;
  /* CHANGED: category chips filter the list, and low-stock items always
     appear at the top so reorders are seen right away */
  var foods = allFoods.filter(function (it) {
    return foodCatFilter === 'all' || (it.material || '') === foodCatFilter;
  });
  foods.sort(function (a, b) {
    var la = isLow(a) ? 0 : 1, lb = isLow(b) ? 0 : 1;
    if (la !== lb) return la - lb;
    return (a.name || '').localeCompare(b.name || '');
  });

  var month = today().slice(0, 7);
  var boughtMonth = 0;
  db.deliveries.forEach(function (d) {
    var it = getItem(d.itemId);
    if (!it || it.category !== 'food') return;
    if ((d.date || '').slice(0, 7) === month) boughtMonth += (d.qty || 0) * (d.cost || 0);
  });
  var usedMonth = 0;
  db.events.forEach(function (ev) {
    if ((ev.date || '').slice(0, 7) === month) usedMonth += eventUsageCost(ev, 'food');
  });

  var html = '<div class="tiles">' +
    tile(money(boughtMonth), 'Bought this month') +
    tile(money(usedMonth), 'Used in events this month') +
    '</div>';
  if (lowCount) html += '<div class="notice red">' + lowCount + ' food item(s) low on stock.</div>';

  /* CHANGED: category chips (same categories as the Database Food tab) */
  var foodMats = getMaterials('food');
  if (foodMats.length) {
    html += '<div class="chips">' +
      '<button class="chip' + (foodCatFilter === 'all' ? ' active' : '') + '" onclick="foodCatFilter=\'all\';render()">All</button>' +
      foodMats.map(function (m) {
        return '<button class="chip' + (foodCatFilter === m ? ' active' : '') + '" onclick="foodCatFilter=\'' + esc(m) + '\';render()">' + esc(m) + '</button>';
      }).join('') +
      '</div>';
  }

  html += '<div class="section-title">Storage Levels</div>';
  if (!foods.length) html += '<div class="empty">' + (foodCatFilter === 'all' ? 'No food items yet. Add one in the Database tab.' : 'No food items in this category.') + '</div>';
  foods.forEach(function (it) {
    var low = isLow(it);
    html += '<div class="card tappable" onclick="openItemForm(\'' + it.id + '\')"><div class="row">' + photoThumb(it) +
      '<div class="grow"><div class="item-name">' + esc(it.name) + '</div>' +
      '<div class="item-meta">' + money(it.price) + '/' + esc(it.unit) + ' · reorder at ' + (it.reorderPoint || 0) + '</div>' +
      (low ? '<span class="badge b-red">Reorder now!</span>' : '') +
      '</div>' +
      '<div><div class="stat-num"' + (low ? ' style="color:var(--red)"' : '') + '>' + (it.stock || 0) + '</div><div class="stat-label">' + esc(it.unit) + '</div></div>' +
      '</div></div>';
  });

  /* CHANGED: deliveries section only shows on the "All" view — hidden when
     a category chip is selected so the filtered list stays focused */
  if (foodCatFilter === 'all') {
    var groups = {};
    var order = [];
    db.deliveries.forEach(function (d) {
      var key = (d.date || '') + '|' + (d.supplier || '') + '|' + (d.checker || '');
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(d);
    });
    order.sort(function (a, b) { return b.localeCompare(a); });

    html += '<div class="section-title">Weekly Stock Purchased / Deliveries</div>';
    if (!order.length) html += '<div class="empty">No deliveries recorded yet.</div>';
    order.slice(0, 15).forEach(function (key) {
      var rows = groups[key];
      var first = rows[0];
      var total = 0;
      var linesHtml = rows.map(function (d) {
        var it = getItem(d.itemId);
        var t = (d.qty || 0) * (d.cost || 0);
        total += t;
        return '<div class="item-meta">• ' + esc(it ? it.name : '(deleted)') + ' — ' + d.qty + ' ' + esc(it ? it.unit : '') + ' × ' + money(d.cost) + ' = <b>' + money(t) + '</b></div>';
      }).join('');
      html += '<div class="card">' +
        '<div class="row"><div class="grow">' +
        '<div class="item-name">Date: ' + fmtDate(first.date) + (first.supplier ? ' · Supplier: ' + esc(first.supplier) : '') + '</div>' +
        '<div class="item-meta">Checker: ' + esc(first.checker || '—') + '</div></div>' +
        '<div><div class="stat-num">' + money(total) + '</div><div class="stat-label">total</div></div></div>' +
        '<div style="margin-top:8px">' + linesHtml + '</div>' +
        '</div>';
    });
    if (order.length > 15) html += '<div class="hint" style="text-align:center">…and ' + (order.length - 15) + ' more</div>';
  }

  html += '<button onclick="openDeliveryForm()" title="New Delivery (Weekly Stock)" style="position:fixed;bottom:calc(96px + env(safe-area-inset-bottom));right:20px;width:56px;height:56px;border-radius:50%;background:#1a7f5a;color:#fff;border:none;font-size:28px;box-shadow:0 4px 10px rgba(0,0,0,0.3);cursor:pointer;z-index:80;display:flex;align-items:center;justify-content:center;line-height:1">＋</button>';
  return html;
}

var deliveryLines = [];
var deliveryHeader = { date: '', supplier: '', checker: '' };

function openDeliveryForm(presetItemId) {
  deliveryLines = [];
  deliveryHeader = { date: today(), supplier: '', checker: '' };
  if (presetItemId) {
    var it = getItem(presetItemId);
    if (it) deliveryLines.push({ itemId: it.id, qty: 0, cost: it.price || 0 });
  }
  renderDeliveryModal();
}

function renderDeliveryModal() {
  var html = '<h3>New Delivery / Stock In</h3>' +
    '<div class="field-row">' +
      '<div class="field"><label>Delivery date</label><input id="d_date" type="date" value="' + esc(deliveryHeader.date) + '" oninput="deliveryHeader.date=this.value"></div>' +
      '<div class="field"><label>Supplier</label><input id="d_supplier" value="' + esc(deliveryHeader.supplier) + '" placeholder="e.g. Aling Nena" oninput="deliveryHeader.supplier=this.value"></div>' +
    '</div>' +
    '<div class="field"><label>Checker (who received/encoded it)</label><input id="d_checker" value="' + esc(deliveryHeader.checker) + '" placeholder="Name" oninput="deliveryHeader.checker=this.value"></div>' +
    '<div class="section-title" style="margin-top:6px">Items Delivered</div>' +
    '<div id="d_lines"></div>' +
    '<button class="btn-add" onclick="addDeliveryLine()">＋ Add Item</button>' +
    '<div class="btn-row"><button class="btn btn-primary btn-block" onclick="saveDelivery()">Save Delivery</button></div>';
  openModal(html);
  refreshDeliveryLines();
}

function addDeliveryLine() {
  openPicker(
    function (it) { return isConsumable(it); },
    function (item) {
      deliveryLines.push({ itemId: item.id, qty: 0, cost: item.price || 0 });
      renderDeliveryModal();
    },
    'Select delivered item'
  );
}

function refreshDeliveryLines() {
  var box = document.getElementById('d_lines');
  if (!box) return;
  if (!deliveryLines.length) { box.innerHTML = '<div class="hint">No items yet. Tap "＋ Add Item".</div>'; return; }
  box.innerHTML = deliveryLines.map(function (dl, i) {
    var it = getItem(dl.itemId);
    return '<div class="card" style="padding:10px">' +
      '<div class="row"><div class="grow"><b>' + esc(it ? it.name : '?') + '</b></div>' +
      '<button class="btn btn-sm" onclick="deliveryLines.splice(' + i + ',1);refreshDeliveryLines()">×</button></div>' +
      '<div class="field-row" style="margin-top:8px">' +
        '<div class="field" style="margin:0"><label>Quantity (' + esc(it ? it.unit : '') + ')</label>' +
        '<input type="number" inputmode="decimal" min="0" step="any" value="' + (dl.qty || '') + '" placeholder="0" oninput="deliveryLines[' + i + '].qty=parseFloat(this.value)||0"></div>' +
        '<div class="field" style="margin:0"><label>Price/unit (' + PESO + ')</label>' +
        '<input type="number" inputmode="decimal" min="0" step="any" value="' + dl.cost + '" oninput="deliveryLines[' + i + '].cost=parseFloat(this.value)||0"></div>' +
      '</div></div>';
  }).join('');
}

function saveDelivery() {
  var date = deliveryHeader.date || today();
  var supplier = (deliveryHeader.supplier || '').trim();
  var checker = (deliveryHeader.checker || '').trim();
  var valid = deliveryLines.filter(function (dl) { return dl.qty > 0; });
  if (!valid.length) { alert('Add at least one item with a quantity.'); return; }
  valid.forEach(function (dl) {
    var it = getItem(dl.itemId);
    if (!it) return;
    it.stock = (it.stock || 0) + dl.qty;
    if (dl.cost > 0) it.price = dl.cost;
    db.deliveries.push({ id: uid(), date: date, supplier: supplier, checker: checker, itemId: dl.itemId, qty: dl.qty, cost: dl.cost || 0 });
  });
  logAction('Delivery received (' + valid.length + ' item(s))' + (supplier ? ' from ' + supplier : ''));
  saveDB(); closeModal(); render();
  toast('Delivery saved (' + valid.length + ' item(s))');
}

/* ============================================================
   TAB: LEADS
   ============================================================ */
var leadSearch = '';

function renderLeads() {
  /* CHANGED: added lead search bar — refreshes only the list so the keyboard stays open */
  var html = '<input class="search" placeholder="Search lead, client/event, or date…" value="' + esc(leadSearch) + '" oninput="leadSearch=this.value;refreshLeadList()">';
  html += '<div class="hint" style="margin:2px 2px 12px">This shows who is <b>cleared</b> and who has <b>pending items or damages</b> from their events.</div>';
  html += '<div id="leadList">' + leadListHTML() + '</div>';
  return html;
}

function leadListHTML() {
  var leads = {};
  var order = [];
  db.events.forEach(function (ev) {
    var name = (ev.lead || '').trim() || '(no lead)';
    if (!leads[name]) { leads[name] = { events: 0, open: 0, pending: 0, issues: 0, damageValue: 0, blob: '' }; order.push(name); }
    var L = leads[name];
    L.events++;
    if (ev.status === 'open') { L.open++; L.pending += eventPending(ev); }
    L.issues += eventIssues(ev);
    L.damageValue += eventDamageValue(ev);
    /* CHANGED: collect each lead's event names + dates so search can match them too */
    L.blob += ' ' + (ev.name || '') + ' ' + (ev.date || '') + ' ' + fmtDate(ev.date) + ' ' + (ev.venue || '');
  });
  order.sort();

  if (!order.length) return '<div class="empty">No events yet, so no lead records yet.</div>';

  /* CHANGED: staff only see their own lead record — other leads are hidden */
  if (!isAdmin()) {
    var myKey = currentUserName().toLowerCase();
    order = order.filter(function (n) { return n.toLowerCase() === myKey; });
    if (!order.length) return '<div class="empty">No event records under your name yet.</div>';
  }

  var q = leadSearch.trim().toLowerCase();
  var filtered = order.filter(function (n) {
    if (!q) return true;
    if (n.toLowerCase().indexOf(q) >= 0) return true;
    return leads[n].blob.toLowerCase().indexOf(q) >= 0;
  });
  if (!filtered.length) return '<div class="empty">No matching leads.</div>';

  window._leadNames = filtered;
  var html = '';
  filtered.forEach(function (name, i) {
    var L = leads[name];
    var cleared = L.pending === 0 && L.issues === 0;
    var badge = cleared ? '<span class="badge b-green">Cleared</span>' :
      (L.pending > 0 ? '<span class="badge b-red">' + L.pending + ' not returned</span>' : '') +
      (L.issues > 0 ? ' <span class="badge b-amber">' + L.issues + ' damaged/lost · ' + money(L.damageValue) + '</span>' : '');
    html += '<div class="card tappable" onclick="go(\'leadDetail\',window._leadNames[' + i + '])">' +
      '<div class="row"><div class="thumb">' + svgIcon('user', 22) + '</div>' +
      '<div class="grow"><div class="item-name">' + esc(name) + '</div>' +
      '<div class="item-meta">' + L.events + ' event' + (L.events > 1 ? 's' : '') + (L.open ? ' · ' + L.open + ' still open' : '') + '</div>' +
      '<div style="margin-top:4px">' + badge + '</div></div>' +
      '</div></div>';
  });
  return html;
}

function refreshLeadList() {
  var el = document.getElementById('leadList');
  if (el) el.innerHTML = leadListHTML();
}
/* CHANGED: find the logged-in staff's lead name as it's actually written
   in the event records (handles casing differences) */
function myLeadName() {
  var myKey = currentUserName().toLowerCase();
  var found = null;
  db.events.forEach(function (ev) {
    var n = (ev.lead || '').trim();
    if (n && n.toLowerCase() === myKey) found = n;
  });
  return found || currentUserName();
}

/* CHANGED: initials for the profile avatar — "Evelyn" → "E", "John Paul" → "JP" */
function nameInitials(n) {
  var parts = (n || '').trim().split(/\s+/);
  if (!parts[0]) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function renderLeadDetail(name) {
  /* CHANGED: staff can only open their own lead record */
  if (!isAdmin() && (name || '').toLowerCase() !== currentUserName().toLowerCase()) {
    return '<button class="back-btn" onclick="go(\'leads\')">← Back to Records</button>' +
      '<div class="empty">You can only view your own lead record.</div>';
  }
  var evs = db.events.filter(function (ev) {
    return ((ev.lead || '').trim() || '(no lead)') === name;
  });
  evs.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  window._leadDetailName = name;
  var total = evs.length;
  /* CHANGED: back button is admin-only — for staff, the Leads tab IS this page */
  var html = isAdmin() ? '<button class="back-btn" onclick="go(\'leads\')">← Back to Records</button>' : '';
  /* CHANGED: profile-style header — centered initials avatar, name, summary
     line, and cleared/pending status badge */
  var openCount = 0, closedCount = 0, pendTotal = 0, lastDate = '';
  evs.forEach(function (ev) {
    if (ev.status === 'open') { openCount++; pendTotal += eventPending(ev); }
    else closedCount++;
    if ((ev.date || '') > lastDate) lastDate = ev.date || '';
  });
  var statusBadge = pendTotal > 0
    ? '<span class="badge b-red">' + pendTotal + ' item(s) to return</span>'
    : '<span class="badge b-green">All cleared</span>';
  html += '<div class="card lead-profile">' +
    '<div class="lp-avatar">' + esc(nameInitials(name)) + '</div>' +
    '<div class="lp-name">' + esc(name) + '</div>' +
    '<div class="item-meta">' + total + ' event record(s)' + (lastDate ? ' · Last event: ' + fmtDate(lastDate) : '') + '</div>' +
    '<div style="margin-top:10px">' + statusBadge + '</div>' +
    (isAdmin() ? '<div style="margin-top:10px"><button class="btn btn-sm" onclick="openRenameLead(window._leadDetailName)">' + svgIcon('edit', 13) + ' Rename</button></div>' : '') +
    '</div>';
  /* CHANGED: searchable event list so a specific event can be found quickly */
  html += '<input class="search" placeholder="Search event, venue, or date…" value="' + esc(leadDetailSearch) + '" oninput="leadDetailSearch=this.value;refreshLeadEvents()">';
  html += '<div id="leadEventList">' + leadEventsHTML(name) + '</div>';
  return html;
}

var leadDetailSearch = '';

function leadEventsHTML(name) {
  var q = leadDetailSearch.trim().toLowerCase();
  var evs = db.events.filter(function (ev) {
    return ((ev.lead || '').trim() || '(no lead)') === name;
  });
  evs.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  if (q) {
    evs = evs.filter(function (ev) {
      return (ev.name || '').toLowerCase().indexOf(q) >= 0 ||
             (ev.venue || '').toLowerCase().indexOf(q) >= 0 ||
             (ev.date || '').indexOf(q) >= 0 ||
             fmtDate(ev.date).toLowerCase().indexOf(q) >= 0;
    });
  }
  if (!evs.length) return '<div class="empty">' + (q ? 'No matching events.' : 'No event records yet.') + '</div>';
  return evs.map(eventCard).join('');
}

function refreshLeadEvents() {
  var el = document.getElementById('leadEventList');
  if (el) el.innerHTML = leadEventsHTML(window._leadDetailName);
}

/* CHANGED: rename a lead across all of their event records (admin only) */
function openRenameLead(name) {
  var html = '<h3>Rename Lead</h3>' +
    '<div class="hint" style="margin-bottom:10px">This will update the lead name on <b>ALL events</b> under "' + esc(name) + '". Use this to fix typos or merge duplicate names (e.g. "ace" into "ACE").</div>' +
    '<div class="field"><label>New name</label><input id="rl_name" value="' + esc(name === '(no lead)' ? '' : name) + '"></div>' +
    '<div class="btn-row"><button class="btn btn-primary btn-block" onclick="doRenameLead(window._leadDetailName)">Save</button></div>';
  openModal(html);
}

function doRenameLead(oldName) {
  if (!isAdmin()) return;
  var newName = document.getElementById('rl_name').value.trim();
  if (!newName) { alert('Enter the new name.'); return; }
  if (newName === oldName) { closeModal(); return; }
  var count = 0;
  db.events.forEach(function (ev) {
    var n = (ev.lead || '').trim() || '(no lead)';
    if (n === oldName) { ev.lead = newName; count++; }
  });
  logAction('Renamed lead "' + oldName + '" → "' + newName + '" (' + count + ' event(s))');
  saveDB(); closeModal();
  go('leadDetail', newName);
  toast('Lead renamed: ' + newName);
}

/* ============================================================
   SHARED: item picker modal
   ============================================================ */
function openPicker(filterFn, onPick, title) {
  pickerCallback = onPick;
  var items = db.items.filter(filterFn).sort(byName);
  var html = '<h3>' + esc(title || 'Select Item') + '</h3>' +
    '<input class="search" placeholder="Search…" oninput="filterPicker(this.value)">' +
    '<div id="pickerList">' + pickerListHTML(items) + '</div>';
  openModal(html);
  window._pickerFilter = filterFn;
}

function pickerListHTML(items) {
  if (!items.length) return '<div class="empty">No matching items. Add one in the Database tab first.</div>';
  return items.map(function (it) {
    var right = isConsumable(it)
      ? (it.stock || 0) + ' ' + esc(it.unit)
      : availableNow(it) + ' avail';
    return '<button class="pick-item" onclick="pickItem(\'' + it.id + '\')">' +
      photoThumb(it) +
      '<div class="grow"><div class="item-name">' + esc(it.name) + '</div><div class="item-meta">' + catLabel(it) + '</div></div>' +
      '<div class="item-meta"><b>' + right + '</b></div>' +
      '</button>';
  }).join('');
}

function filterPicker(q) {
  q = q.trim().toLowerCase();
  var items = db.items.filter(window._pickerFilter).filter(function (it) {
    return !q || it.name.toLowerCase().indexOf(q) >= 0;
  }).sort(byName);
  var el = document.getElementById('pickerList');
  if (el) el.innerHTML = pickerListHTML(items);
}

function pickItem(id) {
  var it = getItem(id);
  var cb = pickerCallback;
  pickerCallback = null;
  if (cb && it) cb(it);
}

/* ============================================================
   SHARED: modal, photo, menu, toast
   ============================================================ */
function openModal(html) {
  /* CHANGED: every modal now has a ✕ close button at the top-right,
     so users can easily back out of any form (New Event, Add Item, Release, etc.) */
  var m = document.getElementById('modal');
  m.style.position = 'relative';
  m.innerHTML =
    '<button onclick="closeModal()" title="Close" aria-label="Close" ' +
    'style="position:absolute;top:10px;right:10px;width:34px;height:34px;border-radius:50%;border:none;' +
    'background:#eceff1;color:#455a64;font-size:15px;font-weight:bold;cursor:pointer;line-height:1;z-index:5;' +
    'display:flex;align-items:center;justify-content:center">✕</button>' + html;
  document.getElementById('modalOverlay').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
  document.getElementById('modal').innerHTML = '';
}
function overlayClick(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
}

function capturePhoto(cb) {
  photoCallback = cb;
  document.getElementById('photoInput').click();
}
document.getElementById('photoInput').addEventListener('change', function () {
  var file = this.files && this.files[0];
  this.value = '';
  if (!file || !photoCallback) return;
  var reader = new FileReader();
  reader.onload = function () {
    var img = new Image();
    img.onload = function () {
      var MAX = 480;
      var w = img.width, h = img.height;
      if (w > h && w > MAX) { h = h * MAX / w; w = MAX; }
      else if (h >= w && h > MAX) { w = w * MAX / h; h = MAX; }
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      var data = c.toDataURL('image/jpeg', 0.72);
      var cb = photoCallback; photoCallback = null;
      cb(data);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

function openMenu() {
  if (fbAuth && !currentUser) { renderLoginScreen(); return; }
  var html = '<h3>Menu</h3>' +
    (currentUser ? '<div class="hint" style="margin-bottom:10px">Signed in as: <b>' + esc(currentUser.email) + '</b> · ' + (isAdmin() ? 'Admin' : 'Event Staff') + '</div>' : '') +
    /* CHANGED: admin-only backup tools */
    (isAdmin()
      ? '<button class="menu-item" onclick="openActivityLog()">' + svgIcon('log') + ' Activity Log</button>' +
        '<button class="menu-item" onclick="openExportSheet()">' + svgIcon('sheet') + ' Export to Excel / Sheets</button>' +
        '<button class="menu-item" onclick="exportData()">' + svgIcon('download') + ' Export Backup (download data)</button>' +
        '<button class="menu-item" onclick="document.getElementById(\'importInput\').click()">' + svgIcon('upload') + ' Import Backup (restore data)</button>' +
        '<button class="menu-item" style="color:#b23b3b" onclick="resetAllEvents()">' + svgIcon('trash') + ' Reset All Event Records</button>'
      : '') +
    '<button class="menu-item" onclick="openSetUsername()">' + svgIcon('user') + ' Set Username</button>' +
    '<button class="menu-item" onclick="openChangePassword()">' + svgIcon('lock') + ' Change Password</button>' +
    '<button class="menu-item" onclick="doLogout()">' + svgIcon('logout') + ' Sign out</button>';
  openModal(html);
}

/* CHANGED: activity log viewer — admin only, with checkboxes to select
   and delete specific entries, plus select-all and clear-all */
function openActivityLog() {
  var logs = db.logs || [];
  var html = '<h3>Activity Log</h3>' +
    '<div class="hint" style="margin-bottom:10px">Who did what, and when. Latest ' + Math.min(logs.length, 100) + ' of ' + logs.length + ' recorded action(s).</div>';
  if (!logs.length) {
    html += '<div class="empty">No activity recorded yet. Actions will appear here from now on.</div>';
  } else {
    html += '<label style="display:flex;align-items:center;gap:9px;padding:6px 4px 10px;font-size:13.5px;font-weight:700;color:var(--muted);cursor:pointer">' +
      '<input type="checkbox" onchange="toggleAllLogs(this.checked)" style="width:17px;height:17px;accent-color:#1a7f5a"> Select all</label>';
    html += logs.slice(0, 100).map(function (L) {
      return '<div class="card" style="padding:10px"><div class="row">' +
        '<input type="checkbox" class="logSel" value="' + esc(L.id) + '" style="width:17px;height:17px;flex-shrink:0;accent-color:#1a7f5a">' +
        '<div class="grow">' +
        '<div class="item-meta">' + esc(L.at) + ' · <b>' + esc(L.by) + '</b></div>' +
        '<div style="margin-top:2px">' + esc(L.text) + '</div>' +
        '</div></div></div>';
    }).join('');
    html += '<div class="btn-row" style="position:sticky;bottom:-18px;background:#fff;padding:12px 0 18px;margin-bottom:-18px;border-top:1px solid var(--line)">' +
      '<button class="btn btn-danger" onclick="deleteSelectedLogs()">Delete Selected</button>' +
      '<button class="btn" onclick="clearActivityLog()">Clear All</button>' +
      '</div>';
  }
  openModal(html);
}

function toggleAllLogs(checked) {
  document.querySelectorAll('.logSel').forEach(function (c) { c.checked = checked; });
}

function deleteSelectedLogs() {
  if (!isAdmin()) return;
  var ids = [];
  document.querySelectorAll('.logSel:checked').forEach(function (c) { ids.push(c.value); });
  if (!ids.length) { alert('Select at least one entry to delete (tap the checkboxes first).'); return; }
  if (!confirm('Delete ' + ids.length + ' selected log entr' + (ids.length > 1 ? 'ies' : 'y') + '? This cannot be undone.')) return;
  db.logs = (db.logs || []).filter(function (L) { return ids.indexOf(L.id) < 0; });
  logAction('Deleted ' + ids.length + ' activity log entr' + (ids.length > 1 ? 'ies' : 'y'));
  saveDB();
  openActivityLog();
  toast('Deleted ' + ids.length + ' log entr' + (ids.length > 1 ? 'ies' : 'y'));
}

function clearActivityLog() {
  if (!isAdmin()) return;
  if (!confirm('Clear the activity log? All ' + (db.logs || []).length + ' recorded action(s) will be removed. This cannot be undone.')) return;
  db.logs = [];
  logAction('Cleared the activity log');
  saveDB();
  openActivityLog();
  toast('Activity log cleared');
}
/* CHANGED: username system — a short username maps to the account email so
   signing in doesn't require typing the full email address.
   Usernames can only be set ONCE; the admin can reset via Firestore console. */
function openSetUsername() {
  openModal('<h3>Set Username</h3><div id="su_body"><div class="hint">Checking…</div></div>');
  if (!fsDB || !currentUser) return;
  fsDB.collection('usernames').where('email', '==', currentUser.email.toLowerCase()).get().then(function (qs) {
    var el = document.getElementById('su_body');
    if (!el) return;
    if (!qs.empty) {
      el.innerHTML =
        '<div class="notice green">You already set your username: <b>' + esc(qs.docs[0].id) + '</b></div>' +
        '<div class="hint">Usernames can only be set once. If you really need to change it, contact the admin.</div>';
    } else {
      el.innerHTML =
        '<div class="hint" style="margin-bottom:10px">Create a short username so you can sign in without typing your full email. It must <b>end with .cm</b> (for Cocktails Manila) — for example: carlmalon.cm. Letters, numbers, dots, or underscores only. <b>You can only set this once</b>, so choose carefully.</div>' +
        '<div class="field"><label>Username</label><input id="su_name" autocapitalize="none" placeholder="e.g. carlmalon.cm"></div>' +
        '<div class="btn-row"><button class="btn btn-primary btn-block" onclick="saveUsername()">Save Username</button></div>';
    }
  }).catch(function () {
    var el = document.getElementById('su_body');
    if (el) el.innerHTML = '<div class="hint">Could not check your username right now. Please try again.</div>';
  });
}

function saveUsername() {
  var uname = document.getElementById('su_name').value.trim().toLowerCase();
  if (!/^[a-z0-9._]{3,20}$/.test(uname)) {
    alert('Username must be 3-20 characters: letters, numbers, dots, or underscores only.');
    return;
  }
  /* CHANGED: every username must end with .cm so the whole team matches,
     e.g. carlmalon.cm */
  if (!/\.cm$/.test(uname)) {
    alert('Username must end with .cm — for example: carlmalon.cm');
    return;
  }
  var myEmail = currentUser.email.toLowerCase();
  /* one-time only: block if this account already has a username */
  fsDB.collection('usernames').where('email', '==', myEmail).get().then(function (qs) {
    if (!qs.empty) {
      alert('You already set your username (' + qs.docs[0].id + '). Usernames can only be set once — contact the admin if you need to change it.');
      closeModal();
      return;
    }
    return fsDB.collection('usernames').doc(uname).get().then(function (snap) {
      if (snap.exists) {
        alert('That username is already taken. Try another one.');
        return;
      }
      /* CHANGED: final confirmation — the username is permanent, so give one
         last chance to double-check the spelling before saving */
      if (!confirm('Are you sure you want to set "' + uname + '" as your username?\n\nPlease double-check the spelling — this can only be set ONCE and cannot be changed afterward.')) {
        return;
      }
      return fsDB.collection('usernames').doc(uname).set({ email: myEmail }).then(function () {
        logAction('Set username: ' + uname);
        saveDB();
        closeModal();
        toast('Username saved: ' + uname + ' — you can now use it to sign in');
      });
    });
  }).catch(function (err) {
    console.error('Username save error', err);
    alert('Could not save the username: ' + err.message);
  });
}

function openChangePassword() {
  var html = '<h3>Change Password</h3>' +
    '<div class="field"><label>New Password</label><input id="cp_new" type="password" placeholder="Min 6 characters"></div>' +
    '<div class="field"><label>Confirm New Password</label><input id="cp_confirm" type="password" placeholder="Retype new password"></div>' +
    '<div class="btn-row"><button class="btn btn-primary btn-block" onclick="doChangePassword()">Update Password</button></div>';
  openModal(html);
}

function doChangePassword() {
  var pass1 = document.getElementById('cp_new').value;
  var pass2 = document.getElementById('cp_confirm').value;
  if (!pass1 || !pass2) { alert('Please fill in both fields.'); return; }
  if (pass1.length < 6) { alert('Password must be at least 6 characters.'); return; }
  if (pass1 !== pass2) { alert('Passwords do not match.'); return; }
  currentUser.updatePassword(pass1).then(function () {
    closeModal();
    toast('Password updated');
  }).catch(function (err) {
    console.error('Change password error', err);
    alert('Could not update password: ' + err.message);
  });
}

function exportData() {
  /* CHANGED: include photos in the backup file */
  var payload = JSON.parse(JSON.stringify(db));
  payload.photosBackup = PHOTOS;
  var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'inventory-backup-' + today() + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  toast('Backup downloaded');
}

/* CHANGED: CSV exports — open directly in Excel, or import into Google Sheets
   (File → Import). Admin only. */
function csvCell(v) {
  v = String(v == null ? '' : v);
  if (/[",\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function downloadCSV(filename, rows) {
  var csv = '\uFEFF' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename + '-' + today() + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  toast('Downloaded: ' + filename + '-' + today() + '.csv');
}

function openExportSheet() {
  if (!isAdmin()) return;
  var html = '<h3>Export to Excel / Sheets</h3>' +
    '<div class="hint" style="margin-bottom:10px">Downloads a CSV file. Open it directly in Excel, or in Google Sheets go to File → Import → Upload.</div>' +
    '<button class="menu-item" onclick="exportItemsCSV()">Inventory Items</button>' +
    '<button class="menu-item" onclick="exportEventsCSV()">Events Summary</button>' +
    '<button class="menu-item" onclick="exportLinesCSV()">Released Items Detail</button>' +
    '<button class="menu-item" onclick="exportDeliveriesCSV()">Deliveries</button>' +
    '<button class="menu-item" onclick="exportLeadsCSV()">Leads Summary</button>' +
    '<button class="menu-item" onclick="exportLogsCSV()">Activity Log</button>';
  openModal(html);
}

function exportItemsCSV() {
  var rows = [['Item', 'Category', 'Type', 'Unit', 'Price/Unit', 'Owned', 'Damaged/Lost', 'Available', 'Stock', 'Reorder Point', 'Value']];
  db.items.slice().sort(byName).forEach(function (it) {
    var consumable = isConsumable(it);
    var value = consumable ? (it.stock || 0) * (it.price || 0) : ownedEffective(it) * (it.price || 0);
    rows.push([
      it.name, catLabel(it), it.material || '', it.unit, it.price || 0,
      consumable ? '' : (it.owned || 0),
      consumable ? '' : totalDamagedLost(it.id),
      consumable ? '' : availableNow(it),
      consumable ? (it.stock || 0) : '',
      consumable ? (it.reorderPoint || 0) : '',
      value
    ]);
  });
  downloadCSV('inventory-items', rows);
}

function exportEventsCSV() {
  var rows = [['Event', 'Date', 'Venue', 'Lead', 'Checker', 'Status', 'Released Value', 'Food Cost', 'Damaged/Lost', 'Damage Value', 'Pending']];
  db.events.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }).forEach(function (ev) {
    rows.push([ev.name, ev.date || '', ev.venue || '', ev.lead || '', ev.checker || '', ev.status,
      eventValueOut(ev), eventUsageCost(ev), eventIssues(ev), eventDamageValue(ev), eventPending(ev)]);
  });
  downloadCSV('events-summary', rows);
}

function exportLinesCSV() {
  var rows = [['Event', 'Date', 'Lead', 'Item', 'Out', 'Returned', 'Damaged', 'Lost', 'Pending', 'Damage Value']];
  db.events.forEach(function (ev) {
    (ev.lines || []).forEach(function (l) {
      var it = getItem(l.itemId);
      rows.push([ev.name, ev.date || '', ev.lead || '', it ? it.name : '(deleted)',
        l.out || 0, l.returned || 0, l.damaged || 0, l.lost || 0, linePending(l),
        ((l.damaged || 0) + (l.lost || 0)) * (it ? (it.price || 0) : 0)]);
    });
  });
  downloadCSV('released-items', rows);
}

function exportDeliveriesCSV() {
  var rows = [['Date', 'Supplier', 'Checker', 'Item', 'Qty', 'Unit', 'Cost/Unit', 'Total']];
  db.deliveries.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }).forEach(function (d) {
    var it = getItem(d.itemId);
    rows.push([d.date || '', d.supplier || '', d.checker || '', it ? it.name : '(deleted)',
      d.qty || 0, it ? it.unit : '', d.cost || 0, (d.qty || 0) * (d.cost || 0)]);
  });
  downloadCSV('deliveries', rows);
}

function exportLeadsCSV() {
  var leads = {}; var order = [];
  db.events.forEach(function (ev) {
    var n = (ev.lead || '').trim() || '(no lead)';
    if (!leads[n]) { leads[n] = { events: 0, pending: 0, issues: 0, dmg: 0 }; order.push(n); }
    leads[n].events++;
    if (ev.status === 'open') leads[n].pending += eventPending(ev);
    leads[n].issues += eventIssues(ev);
    leads[n].dmg += eventDamageValue(ev);
  });
  order.sort();
  var rows = [['Lead', 'Events', 'Pending Items', 'Damaged/Lost', 'Damage Value']];
  order.forEach(function (n) {
    var L = leads[n];
    rows.push([n, L.events, L.pending, L.issues, L.dmg]);
  });
  downloadCSV('leads-summary', rows);
}

function exportLogsCSV() {
  var rows = [['Time', 'By', 'Action']];
  (db.logs || []).forEach(function (L) { rows.push([L.at, L.by, L.text]); });
  downloadCSV('activity-log', rows);
}

document.getElementById('importInput').addEventListener('change', function () {
  var file = this.files && this.files[0];
  this.value = '';
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () {
    try {
      var d = JSON.parse(reader.result);
      if (!d || !d.items || !d.events || !d.deliveries) throw new Error('bad');
      if (!confirm('This will replace the CURRENT data with the contents of the backup (' + d.items.length + ' items, ' + d.events.length + ' events). Continue?')) return;
      /* CHANGED: restore photos too, if the backup contains them */
      if (d.photosBackup) {
        Object.keys(d.photosBackup).forEach(function (pid) {
          PHOTOS[pid] = d.photosBackup[pid];
          if (fsDB) fsDB.collection('photos').doc(pid).set({ data: d.photosBackup[pid] }).catch(function () {});
        });
        delete d.photosBackup;
      }
      db = d;
      logAction('Imported backup file');
      saveDB(); closeModal(); render();
      toast('Backup imported');
    } catch (e) {
      alert('Could not read the file. Make sure it is a backup JSON from this app.');
    }
  };
  reader.readAsText(file);
});

function resetData() {
  if (!confirm('ARE YOU SURE? This will delete ALL items, events, and deliveries. This cannot be undone. Export a backup first if needed.')) return;
  if (!confirm('One last check: really delete everything?')) return;
  db = seedDB();
  saveDB(); closeModal(); render();
  toast('Data reset');
}

var toastTimer = null;
function toast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2600);
}

/* ---------- boot ---------- */
/* CHANGED: hide the splash screen once the app knows what to show */
function hideSplash() {
  var s = document.getElementById('splash');
  if (s) s.style.display = 'none';
}

/* CHANGED: one-time migration — moves photos that are still embedded in the
   main data over to the photos collection, then clears them from the main doc */
var _photosMigrated = false;
function migrateOldPhotos() {
  if (_photosMigrated || !fsDB) return;
  _photosMigrated = true;
  var changed = false;
  db.items.forEach(function (it) {
    if (it.photo) {
      PHOTOS[it.id] = it.photo;
      fsDB.collection('photos').doc(it.id).set({ data: it.photo }).catch(function () {});
      it.photo = null;
      it.hasPhoto = true;
      changed = true;
    }
  });
  if (changed) { saveDB(); render(); toast('Photos moved to safer storage'); }
}

/* CHANGED: keep track of the live listeners so we can properly disconnect on logout */
var _unsubMain = null;
var _unsubPhotos = null;

function stopCloudSync() {
  if (_unsubMain) { _unsubMain(); _unsubMain = null; }
  if (_unsubPhotos) { _unsubPhotos(); _unsubPhotos = null; }
}

function startCloudSync() {
  if (!CLOUD_DOC) return;
  stopCloudSync(); /* avoid duplicate listeners when logging in again */
  _unsubMain = CLOUD_DOC.onSnapshot(function (snap) {
    if (snap.exists) {
      var remote = snap.data();
      if (remote && remote.items && remote.events && remote.deliveries) {
        db = remote;
        try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch (e) {}
        render();
        migrateOldPhotos();
      }
    } else {
      CLOUD_DOC.set(db).catch(function (e) { console.error('Initial cloud push error', e); });
    }
  }, function (err) {
    console.error('Cloud listen error', err);
    /* CHANGED: only warn if someone is actually logged in — a logged-out
       connection error is expected and not worth alarming anyone about */
    if (currentUser) toast('Could not connect to cloud — running offline.');
  });
  /* CHANGED: live-sync item photos from their own collection */
  _unsubPhotos = fsDB.collection('photos').onSnapshot(function (snap) {
    var changed = false;
    snap.docChanges().forEach(function (ch) {
      if (ch.type === 'removed') { delete PHOTOS[ch.doc.id]; changed = true; }
      else { PHOTOS[ch.doc.id] = (ch.doc.data() || {}).data; changed = true; }
    });
    if (changed) render();
  }, function (err) { console.error('Photo sync error', err); });
}

if (fbAuth) {
  fbAuth.onAuthStateChanged(function (user) {
    if (user) {
      currentUser = user;
      /* CHANGED: everyone lands on their Home dashboard on first login (no saved page) */
      try {
        if (!localStorage.getItem('cci-route')) route.tab = 'home';
      } catch (e) { }
      render();
      startCloudSync();
    } else {
      currentUser = null;
      stopCloudSync(); /* CHANGED: disconnect cleanly on logout */
      /* CHANGED: forget the remembered tab on sign-out, so every fresh
         sign-in starts at Home (refresh while logged in still keeps the tab) */
      try { localStorage.removeItem('cci-route'); } catch (e) { }
      route = { tab: 'home', eventId: null, lead: null };
      renderLoginScreen();
    }
    hideSplash();
  });
} else {
  render();
  startCloudSync();
  hideSplash();
}

/* ============================================================
   CHANGED: PULL-TO-REFRESH (mobile)
   Pull down from the very top of the page to reload the app.
   Does not trigger while a modal/form is open.
   ============================================================ */
(function () {
  var startY = 0, pulling = false, dist = 0;
  var TRIGGER = 140; /* how far (px) to pull before it refreshes */

  var ind = document.createElement('div');
  ind.style.cssText =
    'position:fixed;top:-56px;left:50%;margin-left:-22px;width:44px;height:44px;' +
    'border-radius:50%;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.25);' +
    'display:flex;align-items:center;justify-content:center;font-size:22px;color:#1a7f5a;' +
    'z-index:9998;transition:top 0.2s;pointer-events:none';
  ind.textContent = '↻';
  document.body.appendChild(ind);

  function modalOpen() {
    var m = document.getElementById('modalOverlay');
    return m && !m.classList.contains('hidden');
  }

  document.addEventListener('touchstart', function (e) {
    if (window.scrollY <= 0 && !modalOpen()) {
      startY = e.touches[0].clientY;
      pulling = true;
      dist = 0;
    }
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!pulling) return;
    dist = e.touches[0].clientY - startY;
    if (dist > 0 && window.scrollY <= 0) {
      var t = Math.min(dist / 2, 70);
      ind.style.top = (t - 56) + 'px';
      ind.style.transform = 'rotate(' + (dist * 1.5) + 'deg)';
    } else {
      ind.style.top = '-56px';
    }
  }, { passive: true });

  document.addEventListener('touchend', function () {
    if (!pulling) return;
    pulling = false;
    if (dist >= TRIGGER && window.scrollY <= 0) {
      ind.style.top = '14px';
      ind.textContent = '⟳';
      toast('Refreshing…');
      setTimeout(function () { location.reload(); }, 350);
    } else {
      ind.style.top = '-56px';
    }
    dist = 0;
  });
})();
