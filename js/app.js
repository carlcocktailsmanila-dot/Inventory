/* ============================================================
   Inventory App — Event Equipment · Toolbox · Food
   Tatlong sector, per-event tracking, checker accountability.
   Data ay naka-save sa device (localStorage) + export/import backup.
   ============================================================ */

'use strict';

var LS_KEY = 'cci-inventory-v1';
var PESO = '₱';

/* ---------- state ---------- */
var db = loadDB();
var route = { tab: 'events', eventId: null, lead: null };
var dbSearch = '';
var dbFilter = 'all';
var photoTemp = null;        // dataURL habang nag-e-edit ng item form
var photoCallback = null;    // tatawagin pag may na-capture na photo
var pickerCallback = null;   // tatawagin pag may napiling item sa picker

/* ---------- storage ---------- */
function loadDB() {
  try {
    var raw = localStorage.getItem(LS_KEY);
    if (raw) {
      var d = JSON.parse(raw);
      if (d && d.items && d.events && d.deliveries) return d;
    }
  } catch (e) { /* corrupted → seed na lang */ }
  return seedDB();
}

function saveDB() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(db));
  } catch (e) {
    alert('Hindi na-save! Baka puno na ang storage ng device. I-export ang backup at burahin ang mga lumang litrato.');
  }
}

function seedDB() {
  // Sample items para may makita agad ang team sa unang bukas.
  // Pwedeng i-edit o burahin lahat sa Database tab.
  function it(name, category, opts) {
    var o = opts || {};
    return {
      id: uid(), name: name, category: category,
      disposable: !!o.disposable,
      unit: o.unit || 'pcs',
      price: o.price || 0,
      owned: o.owned || 0,       // para sa non-disposable (balikan)
      stock: o.stock || 0,       // para sa consumable (nauubos)
      reorderPoint: o.reorder || 0,
      photo: null, notes: ''
    };
  }
  return {
    version: 1,
    items: [
      it('Chafing Dish', 'event', { owned: 12, price: 1500 }),
      it('Round Table', 'event', { owned: 20, price: 900 }),
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
    deliveries: []   // {id, date, supplier, checker, itemId, qty, cost}
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
  return it.disposable ? 'Toolbox · Disposable' : 'Toolbox · Balikan';
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
// Kabuuang nasira/nawala sa lahat ng events (binabawas sa owned)
function totalDamagedLost(itemId) {
  var t = 0;
  db.events.forEach(function (ev) {
    (ev.lines || []).forEach(function (l) {
      if (l.itemId === itemId) t += (l.damaged || 0) + (l.lost || 0);
    });
  });
  return t;
}
// Nasa labas pa (open events): out - returned - damaged - lost
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
  var navTab = route.tab;
  if (navTab === 'eventDetail') navTab = 'events';
  if (navTab === 'leadDetail') navTab = 'leads';
  document.querySelectorAll('.bottomnav button').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-tab') === navTab);
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
   TAB: DATABASE (master list ng lahat ng items)
   ============================================================ */
function renderDatabase() {
  var q = dbSearch.trim().toLowerCase();
  var items = db.items.filter(function (it) {
    if (dbFilter !== 'all') {
      if (dbFilter === 'toolbox-d' && !(it.category === 'toolbox' && it.disposable)) return false;
      if (dbFilter === 'toolbox-n' && !(it.category === 'toolbox' && !it.disposable)) return false;
      if (dbFilter === 'event' && it.category !== 'event') return false;
      if (dbFilter === 'food' && it.category !== 'food') return false;
    }
    if (q && it.name.toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  items.sort(function (a, b) { return a.name.localeCompare(b.name); });

  var chips = [
    ['all', 'Lahat'], ['event', '🎪 Event'], ['toolbox-n', '🧰 Balikan'],
    ['toolbox-d', '🧰 Disposable'], ['food', '🍲 Food']
  ];

  var html = '<input class="search" placeholder="🔍 Hanapin ang item…" value="' + esc(dbSearch) + '" oninput="dbSearch=this.value;refreshDbList()">';
  html += '<div class="chips">' + chips.map(function (c) {
    return '<button class="chip' + (dbFilter === c[0] ? ' active' : '') + '" onclick="dbFilter=\'' + c[0] + '\';render()">' + c[1] + '</button>';
  }).join('') + '</div>';

  html += '<button class="btn-add" onclick="openItemForm()">＋ Bagong Item</button>';
  html += '<div id="dbList">' + dbListHTML(items) + '</div>';
  return html;
}

function dbListHTML(items) {
  if (!items.length) return '<div class="empty">Walang item. Pindutin ang "＋ Bagong Item" para magdagdag.</div>';
  return items.map(function (it) { return itemCard(it); }).join('');
}

// ina-update lang ang listahan (hindi buong page) para hindi nagsasara ang keyboard habang nagse-search
function refreshDbList() {
  var el = document.getElementById('dbList');
  if (!el) return;
  var q = dbSearch.trim().toLowerCase();
  var items = db.items.filter(function (it) {
    if (dbFilter !== 'all') {
      if (dbFilter === 'toolbox-d' && !(it.category === 'toolbox' && it.disposable)) return false;
      if (dbFilter === 'toolbox-n' && !(it.category === 'toolbox' && !it.disposable)) return false;
      if (dbFilter === 'event' && it.category !== 'event') return false;
      if (dbFilter === 'food' && it.category !== 'food') return false;
    }
    if (q && it.name.toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  items.sort(byName);
  el.innerHTML = dbListHTML(items);
}

function itemCard(it) {
  var avail = availableNow(it);
  var low = isConsumable(it) && it.reorderPoint > 0 && avail <= it.reorderPoint;
  var out = !isConsumable(it) ? pendingOut(it.id) : 0;
  var meta = catLabel(it) + ' · ' + money(it.price) + '/' + esc(it.unit);
  var right;
  if (isConsumable(it)) {
    right = '<div class="stat-num" style="' + (low ? 'color:var(--red)' : '') + '">' + avail + ' ' + esc(it.unit) + '</div>' +
            '<div class="stat-label">' + (low ? '⚠️ Mag-order na!' : 'stock') + '</div>';
  } else {
    right = '<div class="stat-num">' + avail + '/' + ownedEffective(it) + '</div>' +
            '<div class="stat-label">' + (out > 0 ? out + ' nasa labas' : 'kumpleto') + '</div>';
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

/* ---- item add/edit form ---- */
function openItemForm(id) {
  var it = id ? getItem(id) : null;
  photoTemp = it ? it.photo : null;
  var consumable = it ? isConsumable(it) : false;
  var html = '<h3>' + (it ? 'I-edit ang Item' : 'Bagong Item') + '</h3>' +
    '<div class="photo-box" onclick="capturePhoto(function(d){photoTemp=d;refreshFormPhoto()})">' +
      '<div id="formPhoto">' + formPhotoHTML() + '</div>' +
      '<div class="photo-hint">📷 ' + (photoTemp ? 'Palitan' : 'Kumuha ng litrato') + '</div>' +
    '</div>' +
    '<div class="field"><label>Pangalan ng Item</label><input id="f_name" value="' + esc(it ? it.name : '') + '" placeholder="hal. Chafing Dish"></div>' +
    '<div class="field"><label>Kategorya</label><select id="f_cat" onchange="itemFormToggle()">' +
      opt('event', '🎪 Event Item (balikan)', it && it.category === 'event') +
      opt('toolbox-n', '🧰 Toolbox — Balikan (pang-serve)', it && it.category === 'toolbox' && !it.disposable) +
      opt('toolbox-d', '🧰 Toolbox — Disposable (nauubos)', it && it.category === 'toolbox' && it.disposable) +
      opt('food', '🍲 Food / Storage', it && it.category === 'food') +
    '</select></div>' +
    '<div class="field-row">' +
      '<div class="field"><label>Unit</label><input id="f_unit" value="' + esc(it ? it.unit : 'pcs') + '" placeholder="pcs / kg / L"></div>' +
      '<div class="field"><label>Presyo per unit (' + PESO + ')</label><input id="f_price" type="number" inputmode="decimal" min="0" step="any" value="' + (it ? it.price : '') + '" placeholder="0"></div>' +
    '</div>' +
    '<div class="field-row" id="f_nonconsRow" ' + (consumable ? 'style="display:none"' : '') + '>' +
      '<div class="field"><label>Ilan ang pag-aari (owned)</label><input id="f_owned" type="number" inputmode="numeric" min="0" value="' + (it ? it.owned : '') + '" placeholder="0"></div>' +
    '</div>' +
    '<div class="field-row" id="f_consRow" ' + (consumable ? '' : 'style="display:none"') + '>' +
      '<div class="field"><label>Stock ngayon</label><input id="f_stock" type="number" inputmode="decimal" min="0" step="any" value="' + (it ? it.stock : '') + '" placeholder="0"></div>' +
      '<div class="field"><label>Reorder point</label><input id="f_reorder" type="number" inputmode="decimal" min="0" step="any" value="' + (it ? it.reorderPoint : '') + '" placeholder="0"></div>' +
    '</div>' +
    '<div class="btn-row">' +
      (it ? '<button class="btn btn-danger" onclick="deleteItem(\'' + it.id + '\')">Burahin</button>' : '') +
      '<button class="btn btn-primary" onclick="saveItemForm(' + (it ? '\'' + it.id + '\'' : 'null') + ')">I-save</button>' +
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
  if (!name) { alert('Ilagay ang pangalan ng item.'); return; }
  var cat = document.getElementById('f_cat').value;
  var it = id ? getItem(id) : null;
  if (!it) { it = { id: uid(), photo: null, notes: '' }; db.items.push(it); }
  it.name = name;
  it.category = (cat === 'food') ? 'food' : (cat === 'event') ? 'event' : 'toolbox';
  it.disposable = (cat === 'toolbox-d');
  it.unit = document.getElementById('f_unit').value.trim() || 'pcs';
  it.price = num(document.getElementById('f_price').value);
  it.owned = Math.round(num(document.getElementById('f_owned').value));
  it.stock = num(document.getElementById('f_stock').value);
  it.reorderPoint = num(document.getElementById('f_reorder').value);
  it.photo = photoTemp;
  saveDB(); closeModal(); render();
  toast('✅ Na-save: ' + name);
}

function deleteItem(id) {
  var it = getItem(id);
  if (!it) return;
  var used = db.events.some(function (ev) {
    return (ev.lines || []).some(function (l) { return l.itemId === id; }) ||
           (ev.usage || []).some(function (u) { return u.itemId === id; });
  });
  var msg = used
    ? 'Ginamit na ang "' + it.name + '" sa mga event record. Kapag binura, mawawala ito sa mga listahan. Ituloy?'
    : 'Burahin ang "' + it.name + '"?';
  if (!confirm(msg)) return;
  db.items = db.items.filter(function (x) { return x.id !== id; });
  saveDB(); closeModal(); render();
  toast('🗑️ Binura: ' + it.name);
}

/* ============================================================
   TAB: EVENTS (per-event out/in tracking)
   ============================================================ */
function renderEvents() {
  var open = db.events.filter(function (e) { return e.status === 'open'; });
  var closed = db.events.filter(function (e) { return e.status === 'closed'; });
  open.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  closed.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });

  var html = '<button class="btn-add" onclick="openEventForm()">＋ Bagong Event</button>';

  html += '<div class="section-title">Mga Bukas na Event (' + open.length + ')</div>';
  html += open.length ? open.map(eventCard).join('') : '<div class="empty">Walang bukas na event.</div>';

  if (closed.length) {
    html += '<div class="section-title">Tapos na (' + closed.length + ')</div>';
    html += closed.slice(0, 20).map(eventCard).join('');
    if (closed.length > 20) html += '<div class="hint" style="text-align:center">…at ' + (closed.length - 20) + ' pang mas luma</div>';
  }
  return html;
}

function eventCard(ev) {
  var pend = eventPending(ev);
  var issues = eventIssues(ev);
  var badge;
  if (ev.status === 'closed') {
    badge = issues > 0 ? '<span class="badge b-amber">Sarado · may nasira/nawala (' + money(eventDamageValue(ev)) + ')</span>' : '<span class="badge b-gray">Sarado ✓</span>';
  } else {
    badge = pend > 0 ? '<span class="badge b-red">' + pend + ' hindi pa naibabalik</span>' : '<span class="badge b-green">Kumpleto ang balik</span>';
  }
  var val = eventValueOut(ev) + eventUsageCost(ev);
  return '<div class="card tappable" onclick="go(\'eventDetail\',\'' + ev.id + '\')">' +
    '<div class="row"><div class="grow">' +
      '<div class="item-name">' + esc(ev.name) + '</div>' +
      '<div class="item-meta">📅 ' + fmtDate(ev.date) + (ev.venue ? ' · 📍 ' + esc(ev.venue) : '') + '</div>' +
      '<div class="item-meta">👤 Lead: ' + esc(ev.lead || '—') + ' · ✔️ Checker: ' + esc(ev.checker || '—') + '</div>' +
    '</div>' +
    '<div><div class="stat-num">' + money(val) + '</div><div class="stat-label">halaga</div></div></div>' +
    '<div style="margin-top:8px">' + badge + '</div>' +
    '</div>';
}

function openEventForm(id) {
  var ev = id ? getEvent(id) : null;
  var html = '<h3>' + (ev ? 'I-edit ang Event' : 'Bagong Event') + '</h3>' +
    '<div class="field"><label>Pangalan ng Event / Client</label><input id="e_name" value="' + esc(ev ? ev.name : '') + '" placeholder="hal. Santos Wedding"></div>' +
    '<div class="field-row">' +
      '<div class="field"><label>Petsa</label><input id="e_date" type="date" value="' + esc(ev ? ev.date : today()) + '"></div>' +
      '<div class="field"><label>Venue</label><input id="e_venue" value="' + esc(ev ? ev.venue : '') + '" placeholder="hal. Tagaytay"></div>' +
    '</div>' +
    '<div class="field-row">' +
      '<div class="field"><label>Lead (in-charge sa event)</label><input id="e_lead" value="' + esc(ev ? ev.lead : '') + '" placeholder="Pangalan"></div>' +
      '<div class="field"><label>Checker (nag-e-encode)</label><input id="e_checker" value="' + esc(ev ? ev.checker : '') + '" placeholder="Pangalan"></div>' +
    '</div>' +
    '<div class="btn-row"><button class="btn btn-primary btn-block" onclick="saveEventForm(' + (ev ? '\'' + ev.id + '\'' : 'null') + ')">I-save</button></div>';
  openModal(html);
}

function saveEventForm(id) {
  var name = document.getElementById('e_name').value.trim();
  if (!name) { alert('Ilagay ang pangalan ng event.'); return; }
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
  toast('✅ Na-save ang event');
}

/* ---- event detail ---- */
function renderEventDetail(id) {
  var ev = getEvent(id);
  if (!ev) return '<div class="empty">Hindi nahanap ang event.</div>';
  var closed = ev.status === 'closed';
  var pend = eventPending(ev);
  var issues = eventIssues(ev);

  var html = '<button class="back-btn" onclick="go(\'events\')">← Bumalik sa Events</button>';

  html += '<div class="card"><div class="row"><div class="grow">' +
    '<div class="item-name" style="font-size:17px">' + esc(ev.name) + '</div>' +
    '<div class="item-meta">📅 ' + fmtDate(ev.date) + (ev.venue ? ' · 📍 ' + esc(ev.venue) : '') + '</div>' +
    '<div class="item-meta">👤 Lead: <b>' + esc(ev.lead || '—') + '</b> · ✔️ Checker: <b>' + esc(ev.checker || '—') + '</b></div>' +
    '</div>' +
    (!closed ? '<button class="btn btn-sm" onclick="openEventForm(\'' + ev.id + '\')">✏️</button>' : '<span class="badge b-gray">SARADO</span>') +
    '</div></div>';

  if (!closed && pend > 0) html += '<div class="notice red">⚠️ May ' + pend + ' item na hindi pa naibabalik.</div>';
  if (!closed && pend === 0 && (ev.lines || []).length) html += '<div class="notice green">✅ Kumpleto ang naibalik. Pwede nang isara ang event.</div>';
 if (closed && issues > 0) html += '<div class="notice amber">⚠️ May ' + issues + ' item na nasira o nawala sa event na ito (' + money(eventDamageValue(ev)) + ').</div>';

  // summary tiles
  html += '<div class="tiles">' +
    tile(money(eventValueOut(ev)), 'Halaga ng nilabas na gamit') +
    tile(money(eventUsageCost(ev, 'food')), 'Gastos sa food') +
    '</div>';

  /* --- Gamit (balikan): event items + toolbox non-disposable --- */
  html += '<div class="section-title">🎪 Gamit na Nilabas (balikan)</div>';
  var lines = ev.lines || [];
  if (!lines.length) html += '<div class="empty">Wala pang nilalabas na gamit.</div>';
  lines.forEach(function (l, idx) {
    var it = getItem(l.itemId);
    var name2 = it ? it.name : '(burado na ang item)';
    var p = linePending(l);
    html += '<div class="card">' +
      '<div class="row">' + (it ? photoThumb(it) : '<div class="thumb">❓</div>') +
      '<div class="grow"><div class="item-name">' + esc(name2) + '</div>' +
      (l.notes ? '<div class="item-meta">📝 ' + esc(l.notes) + '</div>' : '') + '</div>' +
      (!closed ? '<button class="btn btn-sm btn-primary" onclick="openReturnForm(\'' + ev.id + '\',' + idx + ')">Ibalik</button>' : '') +
      '</div>' +
      '<div class="line-grid">' +
        '<div><div class="lg-num">' + l.out + '</div><div class="lg-label">LABAS</div></div>' +
        '<div><div class="lg-num">' + (l.returned || 0) + '</div><div class="lg-label">BALIK</div></div>' +
        '<div><div class="lg-num">' + ((l.damaged || 0) + (l.lost || 0)) + '</div><div class="lg-label">SIRA/NAWALA</div></div>' +
        '<div class="' + (p > 0 ? 'pend' : 'ok') + '"><div class="lg-num">' + p + '</div><div class="lg-label">PENDING</div></div>' +
      '</div></div>';
  });
  if (!closed) html += '<button class="btn-add" onclick="openReleasePicker(\'' + ev.id + '\')">＋ Maglabas ng Gamit</button>';

  /* --- Consumables: toolbox disposables --- */
  html += '<div class="section-title">🧰 Disposables na Ginamit</div>';
  html += usageList(ev, 'toolbox', closed);
  if (!closed) html += '<button class="btn-add" onclick="openUsagePicker(\'' + ev.id + '\',\'toolbox\')">＋ Gumamit ng Disposable</button>';

  /* --- Food used --- */
  html += '<div class="section-title">🍲 Food na Ginamit</div>';
  html += usageList(ev, 'food', closed);
  if (!closed) html += '<button class="btn-add" onclick="openUsagePicker(\'' + ev.id + '\',\'food\')">＋ Gumamit ng Food</button>';

  /* --- close --- */
  if (!closed) {
    html += '<div class="btn-row" style="margin-top:16px">' +
      '<button class="btn btn-danger" onclick="deleteEvent(\'' + ev.id + '\')">Burahin</button>' +
      '<button class="btn btn-primary" onclick="closeEvent(\'' + ev.id + '\')">🔒 Isara ang Event</button>' +
    '</div>';
    html += '<div class="hint" style="text-align:center;margin-top:6px">Isara kapag tapos na ang event at nabilang na lahat ng gamit.</div>';
  }
  return html;
}

function tile(numStr, label, cls) {
  return '<div class="tile ' + (cls || '') + '"><div class="t-num">' + numStr + '</div><div class="t-label">' + label + '</div></div>';
}

function usageList(ev, category, closed) {
  var rows = (ev.usage || []).map(function (u, idx) { return { u: u, idx: idx }; })
    .filter(function (r) { var it = getItem(r.u.itemId); return it && it.category === category; });
  if (!rows.length) return '<div class="empty">Wala pa.</div>';
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

/* ---- release (maglabas) ---- */
function openReleasePicker(evId) {
  openPicker(
    function (it) { return !isConsumable(it); },
    function (item) { openReleaseQty(evId, item.id); },
    'Piliin ang ilalabas na gamit'
  );
}

function openReleaseQty(evId, itemId) {
  var it = getItem(itemId);
  var avail = availableNow(it);
  var html = '<h3>Ilabas: ' + esc(it.name) + '</h3>' +
    '<div class="hint" style="margin-bottom:10px">Available ngayon: <b>' + avail + '</b> sa ' + ownedEffective(it) + ' ' + esc(it.unit) + '</div>' +
    '<div class="field"><label>Ilang ' + esc(it.unit) + ' ang ilalabas?</label><input id="r_qty" type="number" inputmode="numeric" min="1" placeholder="0" autofocus></div>' +
    '<div class="field"><label>Notes (optional)</label><input id="r_notes" placeholder="hal. kasama sa Van 2"></div>' +
    '<div class="btn-row"><button class="btn btn-primary btn-block" onclick="doRelease(\'' + evId + '\',\'' + itemId + '\')">I-save ang Labas</button></div>';
  openModal(html);
}

function doRelease(evId, itemId) {
  var ev = getEvent(evId); var it = getItem(itemId);
  if (!ev || !it) return;
  var qty = Math.round(num(document.getElementById('r_qty').value));
  if (qty <= 0) { alert('Ilagay kung ilan ang ilalabas.'); return; }
  var avail = availableNow(it);
  if (qty > avail && !confirm('Babala: ' + avail + ' lang ang available na ' + it.name + '. Ituloy pa rin ang ' + qty + '?')) return;
  var notes = document.getElementById('r_notes').value.trim();
  // kung may existing line na sa item na ito, dagdagan na lang
  var line = null;
  (ev.lines || []).forEach(function (l) { if (l.itemId === itemId) line = l; });
  if (line) {
    line.out += qty;
    if (notes) line.notes = (line.notes ? line.notes + '; ' : '') + notes;
  } else {
    ev.lines.push({ itemId: itemId, out: qty, returned: 0, damaged: 0, lost: 0, notes: notes });
  }
  saveDB(); closeModal(); render();
  toast('📤 Nilabas: ' + qty + ' ' + it.name);
}

/* ---- return (ibalik) ---- */
function openReturnForm(evId, lineIdx) {
  var ev = getEvent(evId); var l = ev.lines[lineIdx];
  var it = getItem(l.itemId);
  var p = linePending(l);
  var html = '<h3>Ibalik: ' + esc(it ? it.name : '') + '</h3>' +
    '<div class="hint" style="margin-bottom:10px">Nilabas: <b>' + l.out + '</b> · Naibalik na: <b>' + (l.returned || 0) + '</b> · Pending: <b style="color:var(--red)">' + p + '</b></div>' +
    '<div class="field"><label>Ilang maayos ang naibalik?</label><input id="rt_ok" type="number" inputmode="numeric" min="0" max="' + p + '" value="' + p + '"></div>' +
    '<div class="field"><label>Ilang sira / nawasak?</label><input id="rt_dmg" type="number" inputmode="numeric" min="0" max="' + p + '" value="0"></div>' +
    '<div class="field"><label>Notes (optional)</label><input id="rt_notes" placeholder="hal. basag ang takip"></div>' +
    '<div class="btn-row"><button class="btn btn-primary btn-block" onclick="doReturn(\'' + evId + '\',' + lineIdx + ')">I-save ang Balik</button></div>';
  openModal(html);
}

function doReturn(evId, lineIdx) {
  var ev = getEvent(evId); var l = ev.lines[lineIdx];
  var it = getItem(l.itemId);
  var p = linePending(l);
  var ok = Math.round(num(document.getElementById('rt_ok').value));
  var dmg = Math.round(num(document.getElementById('rt_dmg').value));
  if (ok < 0 || dmg < 0) return;
  if (ok + dmg > p) { alert('Sobra! ' + p + ' lang ang pending na maibabalik.'); return; }
  if (ok + dmg === 0) { alert('Ilagay kung ilan ang naibalik o nasira.'); return; }
  l.returned = (l.returned || 0) + ok;
  l.damaged = (l.damaged || 0) + dmg;
  var notes = document.getElementById('rt_notes').value.trim();
  if (notes) l.notes = (l.notes ? l.notes + '; ' : '') + notes;
  saveDB(); closeModal(); render();
  toast('📥 Naibalik: ' + ok + (dmg ? ' · Sira: ' + dmg : '') + ' — ' + (it ? it.name : ''));
}

/* ---- usage (consumables) ---- */
function openUsagePicker(evId, category) {
  openPicker(
    function (it) { return isConsumable(it) && it.category === category; },
    function (item) { openUsageQty(evId, item.id); },
    category === 'food' ? 'Piliin ang food na ginamit' : 'Piliin ang disposable na ginamit'
  );
}

function openUsageQty(evId, itemId) {
  var it = getItem(itemId);
  var html = '<h3>Gamitin: ' + esc(it.name) + '</h3>' +
    '<div class="hint" style="margin-bottom:10px">Stock ngayon: <b>' + (it.stock || 0) + ' ' + esc(it.unit) + '</b></div>' +
    '<div class="field"><label>Ilang ' + esc(it.unit) + ' ang ginamit?</label><input id="u_qty" type="number" inputmode="decimal" min="0" step="any" placeholder="0" autofocus></div>' +
    '<div class="btn-row"><button class="btn btn-primary btn-block" onclick="doUsage(\'' + evId + '\',\'' + itemId + '\')">I-save</button></div>';
  openModal(html);
}

function doUsage(evId, itemId) {
  var ev = getEvent(evId); var it = getItem(itemId);
  if (!ev || !it) return;
  var qty = num(document.getElementById('u_qty').value);
  if (qty <= 0) { alert('Ilagay kung ilan ang ginamit.'); return; }
  if (qty > (it.stock || 0) && !confirm('Babala: ' + (it.stock || 0) + ' ' + it.unit + ' lang ang stock ng ' + it.name + '. Ituloy pa rin?')) return;
  var u = null;
  (ev.usage || []).forEach(function (x) { if (x.itemId === itemId) u = x; });
  if (u) { u.qty += qty; }
  else { ev.usage.push({ itemId: itemId, qty: qty, cost: it.price || 0 }); }
  it.stock = Math.max(0, (it.stock || 0) - qty);
  saveDB(); closeModal(); render();
  var low = it.reorderPoint > 0 && it.stock <= it.reorderPoint;
  toast('✅ Ginamit: ' + qty + ' ' + it.unit + ' ' + it.name + (low ? ' — ⚠️ mababa na ang stock!' : ''));
}

function editUsage(evId, usageIdx) {
  var ev = getEvent(evId); var u = ev.usage[usageIdx];
  var it = getItem(u.itemId);
  var html = '<h3>I-edit: ' + esc(it.name) + '</h3>' +
    '<div class="hint" style="margin-bottom:10px">Naka-record: <b>' + u.qty + ' ' + esc(it.unit) + '</b>. Kapag binawasan, babalik sa stock ang sobra (hal. naibalik na hindi nagamit).</div>' +
    '<div class="field"><label>Tamang dami ng ginamit</label><input id="ue_qty" type="number" inputmode="decimal" min="0" step="any" value="' + u.qty + '"></div>' +
    '<div class="btn-row">' +
      '<button class="btn btn-danger" onclick="saveUsageEdit(\'' + evId + '\',' + usageIdx + ',true)">Tanggalin</button>' +
      '<button class="btn btn-primary" onclick="saveUsageEdit(\'' + evId + '\',' + usageIdx + ',false)">I-save</button>' +
    '</div>';
  openModal(html);
}

function saveUsageEdit(evId, usageIdx, remove) {
  var ev = getEvent(evId); var u = ev.usage[usageIdx];
  var it = getItem(u.itemId);
  var newQty = remove ? 0 : num(document.getElementById('ue_qty').value);
  if (newQty < 0) return;
  var diff = u.qty - newQty;        // positive = ibabalik sa stock
  if (it) it.stock = Math.max(0, (it.stock || 0) + diff);
  if (newQty === 0) ev.usage.splice(usageIdx, 1);
  else u.qty = newQty;
  saveDB(); closeModal(); render();
  toast('✅ Na-update');
}

/* ---- close / delete event ---- */
function closeEvent(evId) {
  var ev = getEvent(evId);
  var pend = eventPending(ev);
  if (pend > 0) {
    if (!confirm('May ' + pend + ' item pa na HINDI naibabalik. Kapag isinara, itatala ang mga ito bilang NAWALA at ibabawas sa inventory, at lalabas sa record ng lead na si ' + (ev.lead || '—') + '. Ituloy?')) return;
    (ev.lines || []).forEach(function (l) {
      var p = linePending(l);
      if (p > 0) l.lost = (l.lost || 0) + p;
    });
  } else {
    if (!confirm('Isara na ang event na ito? Hindi na ito mae-edit pagkatapos.')) return;
  }
  ev.status = 'closed';
  ev.closedAt = today();
  saveDB(); render();
  toast('🔒 Sarado na ang event');
}

function deleteEvent(evId) {
  var ev = getEvent(evId);
  if (!confirm('Burahin ang event na "' + ev.name + '"? Maibabalik sa stock ang mga na-record na ginamit na consumables.')) return;
  // ibalik sa stock ang mga consumable na nagamit
  (ev.usage || []).forEach(function (u) {
    var it = getItem(u.itemId);
    if (it) it.stock = (it.stock || 0) + u.qty;
  });
  db.events = db.events.filter(function (e) { return e.id !== evId; });
  saveDB(); go('events');
  toast('🗑️ Binura ang event');
}

/* ============================================================
   TAB: TOOLBOX (packaging materials)
   ============================================================ */
function renderToolbox() {
  var disposables = db.items.filter(function (it) { return it.category === 'toolbox' && it.disposable; });
  var returnables = db.items.filter(function (it) { return it.category === 'toolbox' && !it.disposable; });
  disposables.sort(byName); returnables.sort(byName);
  var lowCount = disposables.filter(isLow).length;

  var html = '<div class="tiles">' +
    tile(String(disposables.length + returnables.length), 'Toolbox items') +
    tile(String(lowCount), 'Kailangan nang i-order', lowCount ? 'bad' : '') +
    '</div>';

  html += '<div class="section-title">🧰 Disposables (nauubos)</div>';
  if (!disposables.length) html += '<div class="empty">Wala pang disposable item. Magdagdag sa Database tab.</div>';
  disposables.forEach(function (it) {
    var low = isLow(it);
    html += '<div class="card"><div class="row">' + photoThumb(it) +
      '<div class="grow"><div class="item-name">' + esc(it.name) + '</div>' +
      '<div class="item-meta">Reorder point: ' + (it.reorderPoint || 0) + ' ' + esc(it.unit) + '</div>' +
      (low ? '<span class="badge b-red">⚠️ Mag-order na!</span>' : '<span class="badge b-green">OK ang stock</span>') +
      '</div>' +
      '<div><div class="stat-num"' + (low ? ' style="color:var(--red)"' : '') + '>' + (it.stock || 0) + '</div><div class="stat-label">' + esc(it.unit) + '</div>' +
      '<button class="btn btn-sm btn-primary" style="margin-top:6px" onclick="openDeliveryForm(\'' + it.id + '\')">＋ Dating</button></div>' +
      '</div></div>';
  });

  html += '<div class="section-title">🧰 Balikan (pang-serve)</div>';
  if (!returnables.length) html += '<div class="empty">Wala pang balikan na toolbox item.</div>';
  returnables.forEach(function (it) {
    var out = pendingOut(it.id);
    html += '<div class="card tappable" onclick="openItemForm(\'' + it.id + '\')"><div class="row">' + photoThumb(it) +
      '<div class="grow"><div class="item-name">' + esc(it.name) + '</div>' +
      '<div class="item-meta">' + (out > 0 ? '📤 ' + out + ' nasa labas (naka-event)' : '✅ Kumpleto sa bodega') + '</div></div>' +
      '<div><div class="stat-num">' + availableNow(it) + '/' + ownedEffective(it) + '</div><div class="stat-label">available</div></div>' +
      '</div></div>';
  });
  html += '<div class="hint" style="margin:4px 2px 14px">Ang paglabas/pagbalik ng mga balikan ay ginagawa sa loob ng bawat <b>Event</b>.</div>';
  return html;
}

function byName(a, b) { return a.name.localeCompare(b.name); }
function isLow(it) { return it.reorderPoint > 0 && (it.stock || 0) <= it.reorderPoint; }

/* ============================================================
   TAB: FOOD (storage + weekly deliveries + gastos)
   ============================================================ */
function renderFood() {
  var foods = db.items.filter(function (it) { return it.category === 'food'; });
  foods.sort(byName);
  var lowCount = foods.filter(isLow).length;

  // gastos this month
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
    tile(money(boughtMonth), 'Binili ngayong buwan') +
    tile(money(usedMonth), 'Nagamit sa events ngayong buwan') +
    '</div>';
  if (lowCount) html += '<div class="notice red">⚠️ ' + lowCount + ' food item ang mababa na ang stock.</div>';

  html += '<button class="btn-add" onclick="openDeliveryForm()">＋ Bagong Delivery (Weekly Stock)</button>';

  html += '<div class="section-title">🍲 Storage Levels</div>';
  if (!foods.length) html += '<div class="empty">Wala pang food item. Magdagdag sa Database tab.</div>';
  foods.forEach(function (it) {
    var low = isLow(it);
    html += '<div class="card tappable" onclick="openItemForm(\'' + it.id + '\')"><div class="row">' + photoThumb(it) +
      '<div class="grow"><div class="item-name">' + esc(it.name) + '</div>' +
      '<div class="item-meta">' + money(it.price) + '/' + esc(it.unit) + ' · reorder sa ' + (it.reorderPoint || 0) + '</div>' +
      (low ? '<span class="badge b-red">⚠️ Mag-order na!</span>' : '') +
      '</div>' +
      '<div><div class="stat-num"' + (low ? ' style="color:var(--red)"' : '') + '>' + (it.stock || 0) + '</div><div class="stat-label">' + esc(it.unit) + '</div></div>' +
      '</div></div>';
  });

  /* deliveries history — grouped by date+supplier */
  var groups = {};
  var order = [];
  db.deliveries.forEach(function (d) {
    var key = (d.date || '') + '|' + (d.supplier || '') + '|' + (d.checker || '');
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(d);
  });
  order.sort(function (a, b) { return b.localeCompare(a); });

  html += '<div class="section-title">📦 Weekly Stock Purchased / Deliveries</div>';
  if (!order.length) html += '<div class="empty">Wala pang naitalang delivery.</div>';
  order.slice(0, 15).forEach(function (key) {
    var rows = groups[key];
    var first = rows[0];
    var total = 0;
    var linesHtml = rows.map(function (d) {
      var it = getItem(d.itemId);
      var t = (d.qty || 0) * (d.cost || 0);
      total += t;
      return '<div class="item-meta">• ' + esc(it ? it.name : '(burado)') + ' — ' + d.qty + ' ' + esc(it ? it.unit : '') + ' × ' + money(d.cost) + ' = <b>' + money(t) + '</b></div>';
    }).join('');
    html += '<div class="card">' +
      '<div class="row"><div class="grow">' +
      '<div class="item-name">📅 ' + fmtDate(first.date) + (first.supplier ? ' · ' + esc(first.supplier) : '') + '</div>' +
      '<div class="item-meta">✔️ Checker: ' + esc(first.checker || '—') + '</div></div>' +
      '<div><div class="stat-num">' + money(total) + '</div><div class="stat-label">total</div></div></div>' +
      '<div style="margin-top:8px">' + linesHtml + '</div>' +
      '</div>';
  });
  if (order.length > 15) html += '<div class="hint" style="text-align:center">…at ' + (order.length - 15) + ' pang mas luma</div>';
  return html;
}

/* ---- delivery form (stock in) — gamit din sa toolbox disposables ---- */
var deliveryLines = [];   // {itemId, qty, cost}

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
  var html = '<h3>📦 Bagong Delivery / Stock In</h3>' +
    '<div class="field-row">' +
      '<div class="field"><label>Petsa ng dating</label><input id="d_date" type="date" value="' + esc(deliveryHeader.date) + '" oninput="deliveryHeader.date=this.value"></div>' +
      '<div class="field"><label>Supplier</label><input id="d_supplier" value="' + esc(deliveryHeader.supplier) + '" placeholder="hal. Aling Nena" oninput="deliveryHeader.supplier=this.value"></div>' +
    '</div>' +
    '<div class="field"><label>Checker (sino tumanggap/nag-encode)</label><input id="d_checker" value="' + esc(deliveryHeader.checker) + '" placeholder="Pangalan" oninput="deliveryHeader.checker=this.value"></div>' +
    '<div class="section-title" style="margin-top:6px">Mga Item na Dumating</div>' +
    '<div id="d_lines"></div>' +
    '<button class="btn-add" onclick="addDeliveryLine()">＋ Magdagdag ng Item</button>' +
    '<div class="btn-row"><button class="btn btn-primary btn-block" onclick="saveDelivery()">I-save ang Delivery</button></div>';
  openModal(html);
  refreshDeliveryLines();
}

function addDeliveryLine() {
  openPicker(
    function (it) { return isConsumable(it); },
    function (item) {
      deliveryLines.push({ itemId: item.id, qty: 0, cost: item.price || 0 });
      renderDeliveryModal();   // babalik sa delivery form, buo pa rin ang na-type
    },
    'Piliin ang dumating na item'
  );
}

function refreshDeliveryLines() {
  var box = document.getElementById('d_lines');
  if (!box) return;
  if (!deliveryLines.length) { box.innerHTML = '<div class="hint">Wala pang item. Pindutin ang "＋ Magdagdag ng Item".</div>'; return; }
  box.innerHTML = deliveryLines.map(function (dl, i) {
    var it = getItem(dl.itemId);
    return '<div class="card" style="padding:10px">' +
      '<div class="row"><div class="grow"><b>' + esc(it ? it.name : '?') + '</b></div>' +
      '<button class="btn btn-sm" onclick="deliveryLines.splice(' + i + ',1);refreshDeliveryLines()">✖</button></div>' +
      '<div class="field-row" style="margin-top:8px">' +
        '<div class="field" style="margin:0"><label>Dami (' + esc(it ? it.unit : '') + ')</label>' +
        '<input type="number" inputmode="decimal" min="0" step="any" value="' + (dl.qty || '') + '" placeholder="0" oninput="deliveryLines[' + i + '].qty=parseFloat(this.value)||0"></div>' +
        '<div class="field" style="margin:0"><label>Presyo/unit (' + PESO + ')</label>' +
        '<input type="number" inputmode="decimal" min="0" step="any" value="' + dl.cost + '" oninput="deliveryLines[' + i + '].cost=parseFloat(this.value)||0"></div>' +
      '</div></div>';
  }).join('');
}

function saveDelivery() {
  var date = deliveryHeader.date || today();
  var supplier = (deliveryHeader.supplier || '').trim();
  var checker = (deliveryHeader.checker || '').trim();
  var valid = deliveryLines.filter(function (dl) { return dl.qty > 0; });
  if (!valid.length) { alert('Maglagay ng kahit isang item na may dami.'); return; }
  valid.forEach(function (dl) {
    var it = getItem(dl.itemId);
    if (!it) return;
    it.stock = (it.stock || 0) + dl.qty;
    if (dl.cost > 0) it.price = dl.cost;   // i-update ang latest na presyo
    db.deliveries.push({ id: uid(), date: date, supplier: supplier, checker: checker, itemId: dl.itemId, qty: dl.qty, cost: dl.cost || 0 });
  });
  saveDB(); closeModal(); render();
  toast('📦 Na-save ang delivery (' + valid.length + ' item)');
}

/* ============================================================
   TAB: LEADS (accountability)
   ============================================================ */
function renderLeads() {
  var leads = {};
  var order = [];
  db.events.forEach(function (ev) {
    var name = (ev.lead || '').trim() || '(walang lead)';
   if (!leads[name]) { leads[name] = { events: 0, open: 0, pending: 0, issues: 0, damageValue: 0 }; order.push(name); }
    var L = leads[name];
    L.events++;
    if (ev.status === 'open') { L.open++; L.pending += eventPending(ev); }
    L.issues += eventIssues(ev);
    L.damageValue += eventDamageValue(ev);
  });
  order.sort();

  var html = '<div class="hint" style="margin:2px 2px 12px">Dito makikita kung sino ang <b>cleared</b> at sino ang may <b>pending na gamit o damages</b> mula sa kanilang mga event.</div>';
  if (!order.length) return html + '<div class="empty">Wala pang event kaya wala pang lead record.</div>';

  window._leadNames = order;
  order.forEach(function (name, i) {
    var L = leads[name];
    var cleared = L.pending === 0 && L.issues === 0;
    var badge = cleared ? '<span class="badge b-green">✅ Cleared</span>' :
      (L.pending > 0 ? '<span class="badge b-red">⚠️ ' + L.pending + ' hindi naibabalik</span>' : '') +
      (L.issues > 0 ? ' <span class="badge b-amber">' + L.issues + ' sira/nawala · ' + money(L.damageValue) + '</span>' : '');
    html += '<div class="card tappable" onclick="go(\'leadDetail\',window._leadNames[' + i + '])">' +
      '<div class="row"><div class="thumb">👤</div>' +
      '<div class="grow"><div class="item-name">' + esc(name) + '</div>' +
      '<div class="item-meta">' + L.events + ' event' + (L.events > 1 ? 's' : '') + (L.open ? ' · ' + L.open + ' bukas pa' : '') + '</div>' +
      '<div style="margin-top:4px">' + badge + '</div></div>' +
      '</div></div>';
  });
  return html;
}

function renderLeadDetail(name) {
  var evs = db.events.filter(function (ev) {
    return ((ev.lead || '').trim() || '(walang lead)') === name;
  });
  evs.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  var totalDamage = 0;
  evs.forEach(function (ev) { totalDamage += eventDamageValue(ev); });
  var html = '<button class="back-btn" onclick="go(\'leads\')">← Bumalik sa Leads</button>';
  html += '<div class="card"><div class="row"><div class="thumb">👤</div><div class="grow">' +
    '<div class="item-name" style="font-size:17px">' + esc(name) + '</div>' +
    '<div class="item-meta">' + evs.length + ' event record</div></div></div></div>';
  if (totalDamage > 0) {
    html += '<div class="tiles">' + tile(money(totalDamage), 'Kabuuang halaga ng sira/nawala', 'bad') + '</div>';
  }
  evs.forEach(function (ev) { html += eventCard(ev); });
  return html;
}

/* ============================================================
   SHARED: item picker modal
   ============================================================ */
function openPicker(filterFn, onPick, title) {
  pickerCallback = onPick;
  var items = db.items.filter(filterFn).sort(byName);
  var html = '<h3>' + esc(title || 'Pumili ng Item') + '</h3>' +
    '<input class="search" placeholder="🔍 Hanapin…" oninput="filterPicker(this.value)">' +
    '<div id="pickerList">' + pickerListHTML(items) + '</div>';
  openModal(html);
  // itago ang filter function para magamit sa search
  window._pickerFilter = filterFn;
}

function pickerListHTML(items) {
  if (!items.length) return '<div class="empty">Walang tugmang item. Idagdag muna ito sa Database tab.</div>';
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
  document.getElementById('modal').innerHTML = html;
  document.getElementById('modalOverlay').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
  document.getElementById('modal').innerHTML = '';
}
function overlayClick(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
}

/* photo capture + compress */
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

/* menu (⋮): backup, import, reset */
function openMenu() {
  var itemCount = db.items.length, evCount = db.events.length;
  var html = '<h3>Menu</h3>' +
    '<div class="hint" style="margin-bottom:10px">' + itemCount + ' items · ' + evCount + ' events · naka-save sa device na ito</div>' +
    '<button class="menu-item" onclick="exportData()">💾 I-export ang backup (JSON)</button>' +
    '<button class="menu-item" onclick="document.getElementById(\'importInput\').click()">📥 Mag-import ng backup</button>' +
    '<button class="menu-item danger" onclick="resetData()">🗑️ Burahin lahat ng data</button>' +
    '<div class="hint" style="margin-top:12px">💡 Ang data ay naka-save sa browser ng device na ito. Mag-export ng backup nang regular, lalo na bago mag-import o magpalit ng device.</div>';
  openModal(html);
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
  toast('💾 Na-download ang backup');
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
      if (!confirm('Papalitan nito ang KASALUKUYANG data ng laman ng backup (' + d.items.length + ' items, ' + d.events.length + ' events). Ituloy?')) return;
      db = d;
      saveDB(); closeModal(); render();
      toast('📥 Na-import ang backup');
    } catch (e) {
      alert('Hindi mabasa ang file. Siguraduhing backup JSON mula sa app na ito.');
    }
  };
  reader.readAsText(file);
});

function resetData() {
  if (!confirm('SIGURADO KA BA? Buburahin LAHAT ng items, events, at deliveries. Hindi na ito maibabalik. Mag-export muna ng backup kung kailangan.')) return;
  if (!confirm('Huling tanong: burahin talaga lahat?')) return;
  db = seedDB();
  saveDB(); closeModal(); render();
  toast('🗑️ Na-reset ang data');
}

/* toast */
var toastTimer = null;
function toast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2600);
}

/* ---------- boot ---------- */
render();
