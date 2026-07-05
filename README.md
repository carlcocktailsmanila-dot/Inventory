# 📦 Inventory App — Event · Toolbox · Food

Inventory tracking app para sa catering/events business. Ginawa ito para sa tatlong sector ng inventory:

1. **🎪 Event Items** — mga gamit na nilalabas at **binabalik** (chafing dish, tables, chairs, atbp.)
2. **🧰 Toolbox / Packaging** — may **disposable** (nauubos, may reorder alert) at **balikan** (pang-serve na binabalik)
3. **🍲 Food / Storage** — may dumarating na stock weekly, may lumalabas per event, **may gastos tracking**

Walang kailangang i-install na server o database — isang web app lang ito na pwedeng buksan sa phone o computer.

## ✨ Mga Feature

- **Database tab** — master list ng lahat ng items, may **litrato** (kuha gamit ang camera ng phone), presyo, unit, search at filter
- **Events tab** — **per-event** na tracking: sino ang **Lead**, sino ang **Checker** (nag-e-encode), anong nilabas, anong naibalik, anong nasira o nawala. Kapag tapos at kumpleto na, **isasara ang event** — done is done.
- **Toolbox tab** — stock ng disposables na may **"⚠️ Mag-order na!"** alert kapag mababa na, at status ng mga balikan
- **Food tab** — storage levels, **Weekly Stock Purchased** (petsa + supplier + checker), at kabuuang **gastos ngayong buwan** (binili vs. nagamit sa events)
- **Leads tab** — accountability: sino ang **✅ Cleared** at sino ang may **pending na hindi naibabalik o damages**
- **Backup** — i-export/i-import ang buong data bilang JSON file (menu ⋮ sa taas)
- **Offline** — gumagana kahit walang internet kapag na-open na minsan (PWA)

## 🚀 Paano Gamitin

### Pagbukas ng app

**Option A — GitHub Pages (recommended, para ma-access ng buong team):**
1. Sa GitHub repo: **Settings → Pages → Source: Deploy from a branch**, piliin ang branch at `/ (root)`
2. Bubuksan ang app sa `https://<username>.github.io/Inventory/`
3. Sa phone: buksan ang link sa browser, tapos **"Add to Home Screen"** — magiging parang totoong app na may icon

**Option B — Direkta:** i-download ang files at buksan ang `index.html` sa browser.

### Daloy ng trabaho (workflow)

1. **I-setup ang Database** — ilagay lahat ng items ninyo, kuhaan ng litrato, lagyan ng presyo. May kasamang sample items para makita ang itsura — pwedeng i-edit o burahin.
2. **Bago ang event** — gumawa ng Bagong Event (pangalan, petsa, venue, **Lead**, **Checker**), tapos **"＋ Maglabas ng Gamit"** para sa bawat item na isasama.
3. **Pagkatapos ng event** — pindutin ang **"Ibalik"** sa bawat item: ilan ang maayos, ilan ang sira. I-encode din ang mga **disposable at food na nagamit**.
4. **Isara ang event** kapag kumpleto na. Kung may hindi naibalik, itatala itong **nawala** at lalabas sa record ng Lead.
5. **Pagdating ng delivery** — sa Food tab (o Toolbox), **"＋ Bagong Delivery"**: petsa, supplier, checker, at mga item na dumating. Awtomatikong madadagdag sa stock at masasama sa gastos.
6. **Weekly review** — tingnan ang Food tab para sa gastos ngayong buwan, at ang Leads tab para sa mga may pending.

## ⚠️ Mahalagang Paalala sa Data

Ang data ay naka-save sa **browser ng bawat device** (localStorage). Ibig sabihin:

- **Hindi pa nagsi-sync** ang data sa pagitan ng iba't ibang phone. Kung isang tao (ang Checker) ang nag-e-encode sa isang device, walang problema.
- **Mag-export ng backup nang regular** (menu ⋮ → I-export ang backup). Pwedeng i-import ang backup file sa ibang device para ilipat ang data.
- Huwag mag-clear ng browser data / "clear site data" nang walang backup.

Kung gusto ninyong **sabay-sabay na gumagamit ang maraming tao sa iba't ibang phone na iisa ang data** (real-time sync), kailangan ng online database (hal. Firebase o Supabase) — pwedeng idagdag ito bilang susunod na upgrade.

## 🛠️ Tech

Plain HTML + CSS + JavaScript — walang framework, walang build step, walang dependencies. PWA-ready (manifest + service worker) para sa offline use at "Add to Home Screen".

```
index.html      — app shell
css/style.css   — mobile-first styles
js/app.js       — buong logic at UI
manifest.json   — PWA manifest
sw.js           — offline cache
icon.svg        — app icon
```
