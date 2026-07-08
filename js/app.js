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
  'meanne@gmail.com'
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

/* CHANGED: map each account email to a display name.
   Used to auto-fill the "Lead" field with whoever is logged in. */
var STAFF_NAMES = {
  'carl.cocktailsmanila@gmail.com': 'Carl',
  'meanne@gmail.com': 'Meanne'
  'evelyn@gmail.com': 'Evelyn'

};

function currentUserName() {
  if (!currentUser || !currentUser.email) return '';
  var e = currentUser.email.toLowerCase();
  if (STAFF_NAMES[e]) return STAFF_NAMES[e];
  /* fallback: use the part of the email before @, capitalized */
  var n = e.split('@')[0].replace(/[._-]+/g, ' ');
  return n.charAt(0).toUpperCase() + n.slice(1);
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
    btn.textContent = '🙈 Hide';
  } else {
    input.type = 'password';
    btn.textContent = '👁️ Show';
  }
}
function doLogin() {
  var email = document.getElementById('login_email').value.trim();
  var pass = document.getElementById('login_pass').value;
  if (!email || !pass) { alert('Enter your email and password.'); return; }
  fbAuth.signInWithEmailAndPassword(email, pass).catch(function (err) {
    console.error('Login error', err);
    alert('Wrong email or password. Please try again.');
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
  fbAuth.signOut();
}

function renderLoginScreen() {
  var nav = document.querySelector('.bottomnav');
  if (nav) nav.style.display = 'none';
  var menuBtn = document.querySelector('.icon-btn');
  if (menuBtn) menuBtn.style.display = 'none';
  var v = document.getElementById('view');
  /* CHANGED: sign-up and forgot-password removed — the admin creates all accounts
     directly in Firebase Console (Authentication → Users → Add user) */
  v.innerHTML =
    '<div style="text-align:center;padding:60px 20px">' +
      '<div style="font-size:48px;margin-bottom:12px">📦</div>' +
      '<h2 style="margin-bottom:6px">Cocktails Manila Inventory</h2>' +
      '<p class="hint">Sign in with the account given to you by the admin.</p>' +
      '<div style="max-width:280px;margin:16px auto;text-align:left">' +
        '<div class="field"><label>Email</label><input id="login_email" type="email" placeholder="you@example.com"></div>' +
        '<div class="field"><label>Password</label>' +
          '<div style="position:relative">' +
            '<input id="login_pass" type="password" placeholder="Password" style="padding-right:60px">' +
            '<button type="button" onclick="togglePasswordView()" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:#1a7f5a;font-size:13px;cursor:pointer;padding:4px">👁️ Show</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '<button class="btn btn-primary" onclick="doLogin()">🔐 Sign In</button>' +
    '<div class="hint" style="margin-top:12px">No account or forgot your password? Contact the admin.</div>' +
    '</div>';
}

/* ---------- state ---------- */
var db = loadDB();
var route = { tab: 'events', eventId: null, lead: null };
var dbSearch = '';
var dbFilter = 'all';
var dbTab = 'event';   // 'event' | 'toolbox' | 'food'
var dbMaterialFilter = 'all';
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
      toast('⚠️ No internet — not synced to other devices.');
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
function catIcon(it) {
  if (it.category === 'event') return '🎪';
  if (it.category === 'food') return '🍲';
  return '🧰';
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
  render();
  window.scrollTo(0, 0);
}

function render() {
  if (fbAuth && !currentUser) { renderLoginScreen(); return; }
  var nav = document.querySelector('.bottomnav');
  if (nav) nav.style.display = '';
  var menuBtn = document.querySelector('.icon-btn');
  if (menuBtn) menuBtn.style.display = '';
  /* CHANGED: role-based access — staff (non-admin) can use Events + Leads tabs only.
     Leads is view-only for them (delete buttons are already admin-only). */
  var admin = isAdmin();
  var staffTabs = ['events', 'eventDetail', 'leads', 'leadDetail'];
  if (!admin && staffTabs.indexOf(route.tab) < 0) {
    route.tab = 'events'; route.eventId = null; route.lead = null;
  }
  var navTab = route.tab;
  if (navTab === 'eventDetail') navTab = 'events';
  if (navTab === 'leadDetail') navTab = 'leads';
  document.querySelectorAll('.bottomnav button').forEach(function (b) {
    var t = b.getAttribute('data-tab');
    b.style.display = (admin || t === 'events' || t === 'leads') ? '' : 'none';
    b.classList.toggle('active', t === navTab);
  });
  var v = document.getElementById('view');
  if (route.tab === 'db') v.innerHTML = renderDatabase();
  else if (route.tab === 'events') v.innerHTML = renderEvents();
  else if (route.tab === 'eventDetail') v.innerHTML = renderEventDetail(route.eventId);
  else if (route.tab === 'toolbox') v.innerHTML = renderToolbox();
  else if (route.tab === 'food') v.innerHTML = renderFood();
  else if (route.tab === 'leads') v.innerHTML = renderLeads();
  else if (route.tab === 'leadDetail') v.innerHTML = renderLeadDetail(route.lead);
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

  html += '<input class="search" placeholder="🔍 Search for an item…" value="' + esc(dbSearch) + '" oninput="dbSearch=this.value;refreshDbList()">';

  if (dbTab === 'toolbox') {
    var subChips = [['all', 'All'], ['toolbox-n', '🧰 Returnable'], ['toolbox-d', '🧰 Disposable']];
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
  html += '<button onclick="openItemForm(null,\'' + dbTab + '\')" title="Add Item to ' + dbTabLabel(dbTab) + '" style="position:fixed;bottom:80px;right:20px;width:56px;height:56px;border-radius:50%;background:#1a7f5a;color:#fff;border:none;font-size:28px;box-shadow:0 4px 10px rgba(0,0,0,0.3);cursor:pointer;z-index:50;display:flex;align-items:center;justify-content:center;line-height:1">＋</button>';
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
            '<div class="stat-label">' + (low ? '⚠️ Reorder now!' : 'stock') + '</div>';
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

function photoThumb(it) {
  if (it.photo) return '<img class="thumb" src="' + it.photo + '" alt="">';
  return '<div class="thumb">' + catIcon(it) + '</div>';
}

function openItemForm(id, presetTab) {
  var it = id ? getItem(id) : null;
  photoTemp = it ? it.photo : null;
  var consumable = it ? isConsumable(it) : (presetTab === 'food');
  var presetCat = it ? null : (presetTab === 'toolbox' ? 'toolbox-n' : presetTab || 'event');
  /* CHANGED: when adding from the Toolbox tab, only show Returnable and Disposable options */
  var toolboxOnly = (!it && presetTab === 'toolbox');
  var catOptions;
  if (toolboxOnly) {
    catOptions =
      opt('toolbox-n', '🧰 Returnable (serving)', true) +
      opt('toolbox-d', '🧰 Disposable (runs out)', false);
  } else {
    catOptions =
      opt('event', '🎪 Event Item (returnable)', it ? it.category === 'event' : presetCat === 'event') +
      opt('toolbox-n', '🧰 Toolbox — Returnable (serving)', it ? (it.category === 'toolbox' && !it.disposable) : presetCat === 'toolbox-n') +
      opt('toolbox-d', '🧰 Toolbox — Disposable (runs out)', it ? (it.category === 'toolbox' && it.disposable) : false) +
      opt('food', '🍲 Food / Storage', it ? it.category === 'food' : presetCat === 'food');
  }
  var html = '<h3>' + (it ? 'Edit Item' : 'New Item') + '</h3>' +
    '<div class="photo-box" onclick="capturePhoto(function(d){photoTemp=d;refreshFormPhoto()})">' +
      '<div id="formPhoto">' + formPhotoHTML() + '</div>' +
      '<div class="photo-hint">📷 ' + (photoTemp ? 'Change' : 'Take a photo') + '</div>' +
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
  return '<div class="thumb-lg">📷</div>';
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
  it.photo = photoTemp;
  saveDB(); closeModal(); render();
  toast('✅ Saved: ' + name);
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
  saveDB(); closeModal(); render();
  toast('🗑️ Deleted: ' + it.name);
}

/* ============================================================
   TAB: EVENTS
   ============================================================ */
var eventSearch = '';

function renderEvents() {
  /* CHANGED: search now refreshes only the list (not the whole page),
     so the search box keeps focus and the keyboard stays open while typing */
  var html = '<input class="search" placeholder="🔍 Search by event, lead, or venue…" value="' + esc(eventSearch) + '" oninput="eventSearch=this.value;refreshEventList()">';
  html += '<div id="eventList">' + eventListHTML() + '</div>';
  html += '<button onclick="openEventForm()" title="New Event" style="position:fixed;bottom:80px;right:20px;width:56px;height:56px;border-radius:50%;background:#1a7f5a;color:#fff;border:none;font-size:28px;box-shadow:0 4px 10px rgba(0,0,0,0.3);cursor:pointer;z-index:50;display:flex;align-items:center;justify-content:center;line-height:1">＋</button>';
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
  var open = db.events.filter(function (e) { return e.status === 'open' && matches(e); });
  var closed = db.events.filter(function (e) { return e.status === 'closed' && matches(e); });
  open.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  closed.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });

  var html = '<div class="section-title">Open Events (' + open.length + ')</div>';
  html += open.length ? open.map(eventCard).join('') : '<div class="empty">No open events.</div>';

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
  var val = eventValueOut(ev) + eventUsageCost(ev);
  return '<div class="card tappable" onclick="go(\'eventDetail\',\'' + ev.id + '\')">' +
    '<div class="row"><div class="grow">' +
      '<div class="item-name">' + esc(ev.name) + '</div>' +
      '<div class="item-meta">📅 ' + fmtDate(ev.date) + (ev.venue ? ' · 📍 ' + esc(ev.venue) : '') + '</div>' +
      '<div class="item-meta">👤 Lead: ' + esc(ev.lead || '—') + ' · ✔️ Checker: ' + esc(ev.checker || '—') + '</div>' +
    '</div>' +
    '<div><div class="stat-num">' + money(val) + '</div><div class="stat-label">value</div></div></div>' +
    '<div style="margin-top:8px">' + badge + '</div>' +
    '</div>';
}

function openEventForm(id) {
  var ev = id ? getEvent(id) : null;
  var html = '<h3>' + (ev ? 'Edit Event' : 'New Event') + '</h3>' +
    '<div class="field"><label>Event / Client Name</label><input id="e_name" value="' + esc(ev ? ev.name : '') + '" placeholder="e.g. Santos Wedding"></div>' +
    '<div class="field-row">' +
      '<div class="field"><label>Date</label><input id="e_date" type="date" value="' + esc(ev ? ev.date : today()) + '"></div>' +
      '<div class="field"><label>Venue</label><input id="e_venue" value="' + esc(ev ? ev.venue : '') + '" placeholder="e.g. Tagaytay"></div>' +
    '</div>' +
    '<div class="field-row">' +
      '<div class="field"><label>Lead (in-charge of the event)</label><input id="e_lead" value="' + esc(ev ? ev.lead : currentUserName()) + '" placeholder="Name"></div>' +
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
  if (!ev) { ev = { id: uid(), status: 'open', lines: [], usage: [] }; db.events.push(ev); }
  ev.name = name;
  ev.date = document.getElementById('e_date').value || today();
  ev.venue = document.getElementById('e_venue').value.trim();
  ev.lead = document.getElementById('e_lead').value.trim();
  ev.checker = document.getElementById('e_checker').value.trim();
  saveDB(); closeModal();
  if (isNew) go('eventDetail', ev.id); else render();
  toast('✅ Event saved');
}

/* ---- event detail ---- */
function renderEventDetail(id) {
  var ev = getEvent(id);
  if (!ev) return '<div class="empty">Event not found.</div>';
  var closed = ev.status === 'closed';
  var pend = eventPending(ev);
  var issues = eventIssues(ev);
  var html = '<button class="back-btn" onclick="go(\'events\')">← Back to Events</button>';
  html += '<div class="card"><div class="row"><div class="grow">' +
    '<div class="item-name" style="font-size:17px">' + esc(ev.name) + '</div>' +
    '<div class="item-meta">📅 ' + fmtDate(ev.date) + (ev.venue ? ' · 📍 ' + esc(ev.venue) : '') + '</div>' +
    '<div class="item-meta">👤 Lead: <b>' + esc(ev.lead || '—') + '</b> · ✔️ Checker: <b>' + esc(ev.checker || '—') + '</b></div>' +
    '</div>' +
    (!closed ? '<button class="btn btn-sm" onclick="openEventForm(\'' + ev.id + '\')">✏️</button>' : '<span class="badge b-gray">CLOSED</span>') +
    '</div></div>';
  if (!closed && pend > 0) html += '<div class="notice red">⚠️ ' + pend + ' item(s) not yet returned.</div>';
  if (!closed && pend === 0 && (ev.lines || []).length) html += '<div class="notice green">✅ All items returned. This event can now be closed.</div>';
  if (closed && issues > 0) html += '<div class="notice amber">⚠️ ' + issues + ' item(s) damaged or lost in this event (' + money(eventDamageValue(ev)) + ').</div>';
  html += '<div class="tiles">' +
    tile(money(eventValueOut(ev)), 'Value of items released') +
    tile(money(eventUsageCost(ev, 'food')), 'Food expenses') +
    '</div>';
  html += '<div class="section-title">🎪 Items Released (returnable)</div>';
  var lines = ev.lines || [];
  if (!lines.length) html += '<div class="empty">No items released yet.</div>';
  lines.forEach(function (l, idx) {
    var it = getItem(l.itemId);
    var name2 = it ? it.name : '(item deleted)';
    var p = linePending(l);
    html += '<div class="card">' +
      '<div class="row">' + (it ? photoThumb(it) : '<div class="thumb">❓</div>') +
      '<div class="grow"><div class="item-name">' + esc(name2) + '</div>' +
      (l.notes ? '<div class="item-meta">📝 ' + esc(l.notes) + '</div>' : '') + '</div>' +
      (!closed ? '<button class="btn btn-sm btn-primary" onclick="openReturnForm(\'' + ev.id + '\',' + idx + ')">Return</button>' : '') +
      '</div>' +
      '<div class="line-grid">' +
        '<div><div class="lg-num">' + l.out + '</div><div class="lg-label">OUT</div></div>' +
        '<div><div class="lg-num">' + (l.returned || 0) + '</div><div class="lg-label">RETURNED</div></div>' +
        '<div><div class="lg-num">' + ((l.damaged || 0) + (l.lost || 0)) + '</div><div class="lg-label">DAMAGED/LOST</div></div>' +
        '<div class="' + (p > 0 ? 'pend' : 'ok') + '"><div class="lg-num">' + p + '</div><div class="lg-label">PENDING</div></div>' +
      '</div></div>';
  });
  if (!closed) html += '<div style="margin:6px 0 14px;text-align:center"><button class="btn btn-sm btn-primary" onclick="openReleasePicker(\'' + ev.id + '\')">＋ Release Item</button></div>';

  html += '<div class="section-title">🧰 Disposables Used</div>';
  html += usageList(ev, 'toolbox', closed);
  if (!closed) html += '<div style="margin:6px 0 14px;text-align:center"><button class="btn btn-sm btn-primary" onclick="openUsagePicker(\'' + ev.id + '\',\'toolbox\')">＋ Use Disposable</button></div>';

  html += '<div class="section-title">🍲 Food Used</div>';
  html += usageList(ev, 'food', closed);
  if (!closed) html += '<div style="margin:6px 0 14px;text-align:center"><button class="btn btn-sm btn-primary" onclick="openUsagePicker(\'' + ev.id + '\',\'food\')">＋ Use Food</button></div>';

  if (!closed) {
    html += '<div class="btn-row" style="margin-top:16px">' +
      (isAdmin() ? '<button class="btn btn-danger" onclick="deleteEvent(\'' + ev.id + '\')">Delete</button>' : '') +
      '<button class="btn btn-primary" onclick="closeEvent(\'' + ev.id + '\')">🔒 Close Event</button>' +
    '</div>';
    html += '<div class="hint" style="text-align:center;margin-top:6px">Close this once the event is done and all items have been accounted for.</div>';
  } else if (isAdmin()) {
    html += '<div class="btn-row" style="margin-top:16px">' +
      '<button class="btn btn-danger" onclick="deleteEvent(\'' + ev.id + '\')">🗑️ Delete This Event</button>' +
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
      (!closed ? '<button class="btn btn-sm" onclick="editUsage(\'' + ev.id + '\',' + r.idx + ')">✏️</button>' : '') +
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
    '<div class="field"><label>Notes (optional)</label><input id="r_notes" placeholder="e.g. included in Van 2"></div>' +
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
  var notes = document.getElementById('r_notes').value.trim();
  var line = null;
  (ev.lines || []).forEach(function (l) { if (l.itemId === itemId) line = l; });
  if (line) {
    line.out += qty;
    if (notes) line.notes = (line.notes ? line.notes + '; ' : '') + notes;
  } else {
    ev.lines.push({ itemId: itemId, out: qty, returned: 0, damaged: 0, lost: 0, notes: notes });
  }
  saveDB(); closeModal(); render();
  toast('📤 Released: ' + qty + ' ' + it.name);
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
  saveDB(); closeModal(); render();
  toast('📥 Returned: ' + ok + (dmg ? ' · Damaged: ' + dmg : '') + ' — ' + (it ? it.name : ''));
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
  if (u) { u.qty += qty; }
  else { ev.usage.push({ itemId: itemId, qty: qty, cost: it.price || 0 }); }
  it.stock = Math.max(0, (it.stock || 0) - qty);
  saveDB(); closeModal(); render();
  var low = it.reorderPoint > 0 && it.stock <= it.reorderPoint;
  toast('✅ Used: ' + qty + ' ' + it.unit + ' ' + it.name + (low ? ' — ⚠️ stock running low!' : ''));
}

function editUsage(evId, usageIdx) {
  var ev = getEvent(evId); var u = ev.usage[usageIdx];
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
  saveDB(); closeModal(); render();
  toast('✅ Updated');
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
  saveDB(); render();
  toast('🔒 Event closed');
}

function deleteEvent(evId) {
  var ev = getEvent(evId);
  if (!confirm('Delete event "' + ev.name + '"? Recorded consumables used will be returned to stock.')) return;
  (ev.usage || []).forEach(function (u) {
    var it = getItem(u.itemId);
    if (it) it.stock = (it.stock || 0) + u.qty;
  });
  db.events = db.events.filter(function (e) { return e.id !== evId; });
  saveDB(); go('events');
  toast('🗑️ Event deleted');
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

  html += '<div class="section-title">🧰 Toolbox</div>';
  if (!items.length) html += '<div class="empty">No toolbox items yet. Add one in the Database tab.</div>';

  items.forEach(function (it) {
    if (it.disposable) {
      var low = isLow(it);
      html += '<div class="card"><div class="row">' + photoThumb(it) +
        '<div class="grow"><div class="item-name">' + esc(it.name) + '</div>' +
        '<div class="item-meta">Disposable · Reorder point: ' + (it.reorderPoint || 0) + ' ' + esc(it.unit) + '</div>' +
        (low ? '<span class="badge b-red">⚠️ Reorder now!</span>' : '<span class="badge b-green">Stock OK</span>') +
        '</div>' +
        '<div><div class="stat-num"' + (low ? ' style="color:var(--red)"' : '') + '>' + (it.stock || 0) + '</div><div class="stat-label">' + esc(it.unit) + '</div>' +
        '<button class="btn btn-sm btn-primary" style="margin-top:6px" onclick="openDeliveryForm(\'' + it.id + '\')">＋ Delivery</button></div>' +
        '</div></div>';
    } else {
      /* CHANGED: show avail vs ORIGINAL owned + Incomplete status if may damaged/lost */
      var out = pendingOut(it.id);
      var dl = totalDamagedLost(it.id);
      var statusText;
      if (out > 0) statusText = '📤 ' + out + ' currently out (at an event)';
      else if (dl > 0) statusText = '⚠️ ' + dl + ' damaged/lost — Incomplete';
      else statusText = '✅ Complete in storage';
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
  var foods = db.items.filter(function (it) { return it.category === 'food'; });
  foods.sort(byName);
  var lowCount = foods.filter(isLow).length;

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
  if (lowCount) html += '<div class="notice red">⚠️ ' + lowCount + ' food item(s) low on stock.</div>';

  html += '<div class="section-title">🍲 Storage Levels</div>';
  if (!foods.length) html += '<div class="empty">No food items yet. Add one in the Database tab.</div>';
  foods.forEach(function (it) {
    var low = isLow(it);
    html += '<div class="card tappable" onclick="openItemForm(\'' + it.id + '\')"><div class="row">' + photoThumb(it) +
      '<div class="grow"><div class="item-name">' + esc(it.name) + '</div>' +
      '<div class="item-meta">' + money(it.price) + '/' + esc(it.unit) + ' · reorder at ' + (it.reorderPoint || 0) + '</div>' +
      (low ? '<span class="badge b-red">⚠️ Reorder now!</span>' : '') +
      '</div>' +
      '<div><div class="stat-num"' + (low ? ' style="color:var(--red)"' : '') + '>' + (it.stock || 0) + '</div><div class="stat-label">' + esc(it.unit) + '</div></div>' +
      '</div></div>';
  });

  var groups = {};
  var order = [];
  db.deliveries.forEach(function (d) {
    var key = (d.date || '') + '|' + (d.supplier || '') + '|' + (d.checker || '');
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(d);
  });
  order.sort(function (a, b) { return b.localeCompare(a); });

  html += '<div class="section-title">📦 Weekly Stock Purchased / Deliveries</div>';
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
      '<div class="item-name">📅 ' + fmtDate(first.date) + (first.supplier ? ' · ' + esc(first.supplier) : '') + '</div>' +
      '<div class="item-meta">✔️ Checker: ' + esc(first.checker || '—') + '</div></div>' +
      '<div><div class="stat-num">' + money(total) + '</div><div class="stat-label">total</div></div></div>' +
      '<div style="margin-top:8px">' + linesHtml + '</div>' +
      '</div>';
  });
  if (order.length > 15) html += '<div class="hint" style="text-align:center">…and ' + (order.length - 15) + ' more</div>';

  html += '<button onclick="openDeliveryForm()" title="New Delivery (Weekly Stock)" style="position:fixed;bottom:80px;right:20px;width:56px;height:56px;border-radius:50%;background:#1a7f5a;color:#fff;border:none;font-size:28px;box-shadow:0 4px 10px rgba(0,0,0,0.3);cursor:pointer;z-index:50;display:flex;align-items:center;justify-content:center;line-height:1">＋</button>';
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
  var html = '<h3>📦 New Delivery / Stock In</h3>' +
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
      '<button class="btn btn-sm" onclick="deliveryLines.splice(' + i + ',1);refreshDeliveryLines()">✖</button></div>' +
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
  saveDB(); closeModal(); render();
  toast('📦 Delivery saved (' + valid.length + ' item(s))');
}

/* ============================================================
   TAB: LEADS
   ============================================================ */
var leadSearch = '';

function renderLeads() {
  /* CHANGED: added lead search bar — refreshes only the list so the keyboard stays open */
  var html = '<input class="search" placeholder="🔍 Search lead, client/event, or date…" value="' + esc(leadSearch) + '" oninput="leadSearch=this.value;refreshLeadList()">';
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
    var badge = cleared ? '<span class="badge b-green">✅ Cleared</span>' :
      (L.pending > 0 ? '<span class="badge b-red">⚠️ ' + L.pending + ' not returned</span>' : '') +
      (L.issues > 0 ? ' <span class="badge b-amber">' + L.issues + ' damaged/lost · ' + money(L.damageValue) + '</span>' : '');
    html += '<div class="card tappable" onclick="go(\'leadDetail\',window._leadNames[' + i + '])">' +
      '<div class="row"><div class="thumb">👤</div>' +
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
function renderLeadDetail(name) {
  var evs = db.events.filter(function (ev) {
    return ((ev.lead || '').trim() || '(no lead)') === name;
  });
  evs.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  var html = '<button class="back-btn" onclick="go(\'leads\')">← Back to Leads</button>';
  html += '<div class="card"><div class="row"><div class="thumb">👤</div><div class="grow">' +
    '<div class="item-name" style="font-size:17px">' + esc(name) + '</div>' +
    '<div class="item-meta">' + evs.length + ' event record(s)</div></div></div></div>';
  evs.forEach(function (ev) { html += eventCard(ev); });
  return html;
}

/* ============================================================
   SHARED: item picker modal
   ============================================================ */
function openPicker(filterFn, onPick, title) {
  pickerCallback = onPick;
  var items = db.items.filter(filterFn).sort(byName);
  var html = '<h3>' + esc(title || 'Select Item') + '</h3>' +
    '<input class="search" placeholder="🔍 Search…" oninput="filterPicker(this.value)">' +
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
    (currentUser ? '<div class="hint" style="margin-bottom:10px">Signed in as: <b>' + esc(currentUser.email) + '</b> · ' + (isAdmin() ? '👑 Admin' : '🎪 Event Staff') + '</div>' : '') +
    /* CHANGED: admin-only backup tools */
    (isAdmin()
      ? '<button class="menu-item" onclick="exportData()">💾 Export Backup (download data)</button>' +
        '<button class="menu-item" onclick="document.getElementById(\'importInput\').click()">📥 Import Backup (restore data)</button>'
      : '') +
    '<button class="menu-item" onclick="openChangePassword()">🔑 Change Password</button>' +
    '<button class="menu-item" onclick="doLogout()">🚪 Sign out</button>';
  openModal(html);
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
    toast('✅ Password updated');
  }).catch(function (err) {
    console.error('Change password error', err);
    alert('Could not update password: ' + err.message);
  });
}

function exportData() {
  var blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'inventory-backup-' + today() + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  toast('💾 Backup downloaded');
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
      db = d;
      saveDB(); closeModal(); render();
      toast('📥 Backup imported');
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
  toast('🗑️ Data reset');
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
function startCloudSync() {
  if (!CLOUD_DOC) return;
  CLOUD_DOC.onSnapshot(function (snap) {
    if (snap.exists) {
      var remote = snap.data();
      if (remote && remote.items && remote.events && remote.deliveries) {
        db = remote;
        try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch (e) {}
        render();
      }
    } else {
      CLOUD_DOC.set(db).catch(function (e) { console.error('Initial cloud push error', e); });
    }
  }, function (err) {
    console.error('Cloud listen error', err);
    toast('⚠️ Could not connect to cloud — running offline.');
  });
}

if (fbAuth) {
  fbAuth.onAuthStateChanged(function (user) {
    if (user) {
      currentUser = user;
      render();
      startCloudSync();
    } else {
      currentUser = null;
      renderLoginScreen();
    }
  });
} else {
  render();
  startCloudSync();
}
