# Inner Map — Project Context & Decisions

> Running summary of founder discussions. Update this file whenever a decision changes.
> Started: 2026-10-15 · Status: **discussion / design phase — no code yet**
> Platform architecture (multi-campus, multi-industry): see [`HIGH_LEVEL_ARCHITECTURE.md`](./HIGH_LEVEL_ARCHITECTURE.md)
> Detailed design (formats, interfaces, algorithms, DB, APIs): see [`LOW_LEVEL_DESIGN.md`](./LOW_LEVEL_DESIGN.md)
> Tools and services we use, and why: see [`TECH_STACK.md`](./TECH_STACK.md)
> First build — editor + visitor app prototype: see [`PROTOTYPE.md`](./PROTOTYPE.md)
> Step-by-step build phases for the prototype: see [`PHASES.md`](./PHASES.md)

---

## 1. What we're building

**Inner Map** — indoor navigation inside a building or campus, focused first on **colleges and hospitals**.

**One-liner:**
> "Indoor navigation a hospital can set up in a day with a phone and some stickers. Visitors get directions through WhatsApp or a QR code, with no app and no hardware."

**Team roles:** Founder + Claude as cofounder (business, code, development, maintenance).

---

## 2. Competitor landscape

> ⚠️ From general knowledge, not fresh research. Verify pricing/customers before using in pitches.

The industry has two kinds of company:
- **Map + distribution first:** MazeMap, Mappedin
- **Positioning first:** Pointr, Situm

| | MazeMap | Mappedin | Pointr | Situm |
|---|---|---|---|---|
| Origin | Norway (NTNU spin-off) | Canada | London | Spain (Univ. of Santiago spin-off) |
| Main strength | Room links inside timetables / appointment letters | Self-serve map editor, SDKs, kiosks | Accurate beacon positioning + analytics | Positioning without beacons |
| How maps get made | They convert customer CAD (DWG) | Self-serve "Maker" or CAD conversion | AI converts CAD | Dashboard + calibration walk |
| Blue dot | Building Wi-Fi (Cisco/Aruba) or beacons | Third-party providers | BLE beacons | Wi-Fi + magnetic field + motion sensors (+ BLE on iOS) |
| Main markets | Universities, hospitals | Malls, venues, kiosks | Enterprise offices, hospitals | Hospitals, staff tracking |
| Setup effort | Medium | Low to medium | High | Medium |

### Key facts about live tracking ("blue dot")
- **Not everyone uses it**, and most real visitor usage is a static map + directions.
- Live tracking **requires a native app/SDK**. Visitors don't install apps, so mostly staff use it.
- **How they do it:**
  - **BLE beacons:** signal strength from beacons every 5–10 m. Costs hardware + batteries.
  - **Wi-Fi fingerprinting:** a calibration walk records signal patterns. Android only, and Android throttles scans.
  - **Network-side Wi-Fi:** the access points locate the phone. 5–10 m accuracy, needs expensive Cisco/Aruba systems.
  - **Magnetic field:** the building's steel frame creates unique patterns. Needs calibration and movement.
  - **Step counting:** accelerometer + gyroscope + barometer. Drifts, so it's used as glue between other methods.
  - **Sensor fusion:** a particle filter combined with the map (guesses that go through walls are deleted).
- **What they actually earn money from:** blue-dot navigation, **staff/asset tracking**, analytics/heatmaps, location-based alerts.
- **Browsers cannot scan BLE beacons or Wi-Fi** (especially on iOS). A web-only product cannot have a hardware-free blue dot except through motion sensors or the camera.

### Lessons we take
1. Copy MazeMap's **links inside existing workflows**, but for India that means **WhatsApp**.
2. Copy Mappedin's **self-serve editor**, but make it even faster.
3. **Stay away from** Pointr's world (hardware, enterprise analytics). Asset tracking is a possible hospital upsell later.
4. **The gap:** price, and the Indian / emerging market, which all four are too expensive for.

---

## 3. How we're different (zero hardware)

**Core idea:** the building already has what we need: room numbers, signboards, fire-evacuation plans, staff, and visitors with phones and WhatsApp.

1. **Free positioning:** QR stickers (~₹2 each) + **room numbers as anchors** (type "I'm near 214"). Later: reading the door sign with the camera, and step counting in the browser.
2. **Mapping in about an hour:** photograph the fire-evacuation plan → AI turns it into rooms/corridors → admin fixes it. *(v2)* This is our main technical moat.
3. **WhatsApp + local languages:** a directions link inside appointment messages, a WhatsApp bot ("X-ray kahan hai?", voice notes), directions in Hindi and regional languages written around landmarks.
4. **Maps that stay up to date:** a "this is wrong" button, staff edit from their phone, changes go live instantly.
5. **Works offline:** basements (radiology, labs) often have no signal.
6. **Kiosks on hardware they already have:** an old tablet or lobby TV with a QR code.
7. **Business value from the data:** every scan or "I'm lost" tap shows where visitors get confused → "41% of visitors going to Radiology get lost at the Block B junction."

| | Beacon-based competitor | Us |
|---|---|---|
| Hardware | ₹1.5–3 lakh in beacons | ~₹500 in QR stickers |
| Mapping | Weeks + CAD fees | 1 afternoon |
| Maintenance | Battery swaps, recalibration | Staff edit from their phone |
| Visitor needs | App install | Nothing: QR / link / WhatsApp |

**Pricing (to test, not final):** free tier for 1 small building. Paid plans ~**₹3k–10k per building per month**. Sell to hospitals on fewer questions at reception and fewer missed appointments.

**Go-to-market (proposed):** build on a college (easy access, students test for free), sell to hospitals (real pain, real budget).

**About the moat:** individual features can be copied. What protects us: mapping fast enough that being cheap is still profitable + WhatsApp/vernacular focus + regional relationships.

---

## 4. Core navigation model ✅ DECIDED

**No live tracking. No hardware.**

```
Scan QR at entrance (or type a room number)
        ↓
Pick a destination
        ↓
Step-by-step checkpoints → user taps "✓ I'm here" to move to the next step
        ↓
Lost? → scan the nearest QR / type the nearest room number / "Do you see any of these?"
        → app re-routes to the SAME saved destination
```

**Rules:**
- **The destination is saved on the phone.** Every QR is a link (e.g. `innermap.in/h/city-hospital/q/F2-J3`). Scanning any QR with the normal camera mid-route re-routes automatically.
- **Placing checkpoints:** one at **every decision point** (turns, junctions, stairs, lifts, floor changes), and no more than **30–40 m apart** in long corridors.
- **Checkpoints are named after visible landmarks:** "Pharmacy counter (green board)", not "Junction 7".
- Checkpoints are virtual; **only important ones have a QR** (entrances, lifts, major junctions), so ~10–20 stickers per floor.
- **Recovery options:** scan a QR, type the room number on the nearest door, or pick from the 4–6 nearest landmarks.
- **Wrong taps:** "Go back a step" / "I'm somewhere else".
- **Floor change = 3 steps:** lift lobby → "Press 2" → exit the lift and turn.
- **QR stickers:** a short code printed under the QR (e.g. "F2-J3") in case it can't be scanned, a laminated branded design (to prevent fake-QR scams), and a mini "You are here" map on the sticker.

---

## 5. Ultra-lightweight requirement ✅ DECIDED

**Target users:** cheap phones, 2G/3G, basements with no signal.

- **No photos** in directions. Landmark-rich text instead.
- **No map library** (MapLibre is ~800 KB). **No web fonts. No heavy framework** in the visitor app.
- Visitor app = plain **TypeScript**, compiled into one small file.
- **Static files on a CDN** (e.g. Cloudflare Pages). No server work when a visitor scans a QR → **~₹0 hosting per building**.
- **Cache first:** a service worker saves the app + data. After the first visit, it works offline.
- **Routing runs on the phone** (shortest path over a few hundred checkpoints takes milliseconds).
- **Size budgets are checked in the build**, so the build fails if the app grows past them.

| Budget (compressed) | Target |
|---|---|
| Visitor app (code + styles + page) | ≤ 30–35 KB |
| One floor chunk | ~2–10 KB |
| Campus manifest | ~3–8 KB |
| Every visit after the first | 0 KB (offline cache) |

**Two apps, two standards:**

| | Visitor app | Admin editor |
|---|---|---|
| Who uses it | Patients, students, visitors | Hospital/college staff, and us |
| Device | Cheap phone, weak signal | Laptop on office Wi-Fi |
| Weight | Extremely light | Can be heavier (Preact/React is fine) |

---

## 6. UI: good-looking but light

What makes apps heavy is images, fonts and libraries, not good design.

| Technique | Cost | Use it for |
|---|---|---|
| **Design tokens** (CSS variables) | ~1 KB | Consistent look, dark mode, per-hospital branding |
| **SVG icon sheet** (~40 icons) | ~3 KB, cached forever | Lift, stairs, toilet, pharmacy, emergency, lock, accessibility |
| **Emoji** | 0 KB | Decoration only (🏥 💊 🧪 🚻 ☕) |
| **Floor map sketch drawn on the phone** | 0 KB extra | Built from checkpoint coordinates |
| **CSS transitions** | ~0 | Taps, step changes, progress |

- **Each floor gets a color** (Ground = teal, 1st = amber, 2nd = violet…), used everywhere.
- **Each category gets a color:** emergency red, OPD blue, labs purple, food green.
- **The step card is the hero of the screen:** big arrow, big text, progress dots, large ✓ button.
- **Emoji caveat:** they look different by phone brand, and older Android may show blank boxes → **functional icons = SVG**, emoji only for decoration (and only older emoji).

**Rules for future animations:**
- Animate only `transform` + `opacity` (runs smoothly on cheap phones).
- **Never hide content behind an animation** (no fade-in from opacity 0): if the animation stalls on a slow phone, the screen stays blank. Learned in Phase 4.
- Route line "draws itself" in CSS on the SVG map sketch.
- **Avoid:** Lottie (~60 KB), blur/glass effects, heavy shadows.
- Respect the phone's **reduce motion** setting.

```
┌────────────────────────────────┐
│ 🟣 Floor 2      Step 3 of 5    │
│ ●●●○○                          │
│        ↰  (big SVG arrow)      │
│  Turn LEFT at the              │
│  💊 PHARMACY counter           │
│  (green board)                 │
│ ┌────────────────────────────┐ │
│ │      ✓  I'm here           │ │
│ └────────────────────────────┘ │
│   😕 I'm lost   · 🗺 Show map  │
└────────────────────────────────┘
```

### 6.1 2D map, Google-Maps style ✅ DECIDED (2026-10-15)

The visitor sees a **simple 2D map**: flat shapes only, no photos, no 3D. Design reference: the mockups in `images/`.
- **Inside a building** (Phase 9): grey walls, white corridors, pastel rooms with numbers, doors, stairs, lifts, emoji amenities. On top of that: the blue route line, a "You are here" dot and a floor picker.
- **Campus** (Phase 10): building blocks, roads, green grounds and entrance arrows. Routes go between buildings.
  - **Model (decided 2026-10-16):** one **shared Ground level** holds the outdoors *and* every building's ground floor (like Google Maps), so walking in through a door is an ordinary line — routing didn't change. Upper floors and basements **belong to one building** (`level.building`); floor order is unique per building. Floors are counted per building, so another building's Floor 1 never slows a lift ride.
  - **Zoom decides the view:** zoomed out the phone shows building blocks with their names; zoomed in it shows rooms. Tapping a building zooms into it and the floor picker lists its floors ("Block A · Floor 2"). On a building's upper floor the campus around it is drawn faded.
- **Google Maps (mobile app) look — decided 2026-10-16** (founder: "I like exactly Google Maps in app style"):
  - the map fills the whole screen; a white floating **search bar** (red pin, "Search <site>", QR button) with a swipeable row of **chips** (Toilet · Water · ATM · categories) on top;
  - Google-style **floor buttons** (2 / 1 / G, a blue dot on your floor) and a compass on the right; a round **"my location"** button above the sheet (blue while the map follows the route);
  - a **bottom sheet**: "You are at …", "Where to?", step-free, and every place as a Google-style row (round category icon, name, number · category, floor badge); tap or swipe the handle to make it taller. Typing opens a **full-screen search page** with a back arrow;
  - while walking: a **green direction banner** on top (big arrow, distance, instruction, "Then ↱ …"), and at the bottom "**2 min** · 80 m", "Route to X · Step 1 of 5", a red ✕, a blue ? (I'm lost) and a blue pill **✓ I'm here**;
  - **color-coded places**: each room category has a color (rooms tinted, labels in that color, a round icon badge like Google places); roads white, lawns green, parking with a blue P, the route Google blue with a darker edge, the destination a red pin, a fading blue beam in front of the dot;
  - **navigation flow** (decided 2026-10-16): choose (search, list, or tap a room on the map) → **preview** of the whole route with From / To fields and **Start** → walk. On the map: walked path grey, this leg blue, the rest light blue with arrows; checkpoints ✓ / pulsing / numbered; two-finger rotate, compass back to north;
  - **directions named by checkpoints** (2026-10-16): banner = short move + "from <checkpoint> → <next checkpoint>"; corners without a landmark take the nearest room's name. **The map stays north-up** (founder found auto-rotation unpleasant); turning with the visitor is opt-in via the compass;
  - laptops: the same panels float in a 392 px column on the left, the map fills the screen behind them; routes are framed in the part of the map no panel covers.
- **Light by design:**
  - our own SVG viewer (~4 KB brotli), not Leaflet or MapLibre;
  - map shapes are optional `shapes` on each floor of the map file (the 3-floor demo is 1.8 KB); v0 publishing can split floors into separate files for huge campuses;
  - the first visit is 22.3 KB with the campus demo (target ≤ 30 KB).
- **Text stays the hero.** The map adds confidence; it isn't required. A floor without shapes shows a corridor sketch drawn from the walking lines.
- **Facing-up:** after a QR scan the map rotates so "up" is straight ahead, using the sticker's known facing. Google Maps can't do this indoors.

---

## 7. Architecture: production-grade, SOLID, practical

**TypeScript interfaces add 0 bytes** to the compiled app, so clean architecture doesn't slow the phone.
**Rule:** add an interface wherever we already know a second version is coming. Don't over-abstract.

### Layers
```
UI (visitor app / admin editor)         views, components
Use cases                               StartNavigation, Reroute, ConfirmCheckpoint, Search
Domain (pure TypeScript, no browser)    Graph, Router, AccessPolicy, InstructionBuilder
Infrastructure                          ChunkLoader, Cache, Auth, Analytics queue, i18n
→ dependencies only point toward Domain; Domain depends on nothing
```

### Repo layout (one repo, separate packages)
- `packages/core`: domain + use cases, **shared** by the visitor app, admin editor and server (routing is identical everywhere)
- `apps/visitor`: the ultra-light app
- `apps/admin`: the editor
- `services/api`: auth, publishing, serving restricted data

### SOLID in our project
| Principle | Applied |
|---|---|
| **S: one job per piece** | `Router` only finds paths; `InstructionBuilder` only writes "Turn left at…"; `ChunkLoader` only fetches data |
| **O: add without editing** | Connection types (walk/stairs/lift/ramp/escalator) are plug-in rules. Access layers are merged on top of the base graph. |
| **L: interchangeable** | Every `DataSource` (network / cache / bundled) behaves the same |
| **I: small interfaces** | `PositionSource` has one method: "where am I?". QR, room number and landmark are implementations. Camera sign reading plugs in later. |
| **D: depend on interfaces** | Use cases receive `AccessPolicy`, `ChunkLoader`, `Translator`. One startup file wires everything. Tests use fakes. |

### Production basics from day 1
- **Version number on the data format** + converters from old versions (old cached data never crashes a newer app)
- **Translations from day 1** (Hindi + English at launch)
- **Internal event system** ("checkpoint confirmed" etc.). Analytics and cache warming listen without being tangled into navigation code.
- **Feature flags per building**

### Example building data (short keys)
```json
{
  "v": 3,
  "name": "City Hospital",
  "floors": ["G", "1", "2"],
  "cp": [
    ["E1", 0, 12, 40, "Main Entrance"],
    ["L1", 0, 30, 40, "Lift lobby, near reception"],
    ["F2-J3", 2, 30, 18, "Pharmacy counter (green board)"]
  ],
  "ed": [["E1", "L1", 18], ["L1", "L2", 0, "lift"]],
  "dest": [["Radiology", "F2-R7"], ["OPD 12", "F1-D12"]]
}
```
`cp` = checkpoint: id, floor, x, y, landmark text · `ed` = connection: from, to, distance, type (default walk)

---

## 8. Loading data on demand (huge campuses)

**Don't download the whole campus.** But on 2G, the **number of requests matters more than their size** (0.5–1 s each just to start) → small buildings stay **1 file**, big campuses are split. The publishing step decides automatically based on size.

### How the data is organized
```
Campus manifest (~3–8 KB)   ← downloaded on the first scan
 ├─ buildings, entrances, outdoor paths between buildings
 ├─ portals on each floor (lifts, stairs, doors to other buildings)
 ├─ ⭐ PRE-COMPUTED distances between the portals on each floor
 ├─ top ~50 destinations
 └─ version fingerprint of every chunk
Floor chunks (~2–10 KB)     ← loaded on demand
Search index chunks         ← loaded when the user starts typing (split by building)
```

### ⭐ The key trick
Precomputed portal-to-portal distances → **exact shortest route using only the start floor + destination floor chunks**. Floors in between and outdoor paths use the manifest. (A small version of how road-routing systems like Google Maps work.)

### Downloading ahead
- On route start → download the floors along the route in the background.
- On QR scan → preload floors directly connected by lifts or stairs.
- **Data Saver / 2G** → download only what's needed right now.

### Caching
- **A content fingerprint in each chunk's filename** → cached forever.
- An edit to Floor 2 → only the Floor 2 chunk is downloaded again (updates cost a few KB).
- Only the manifest is checked for updates, and only when online.
- A storage limit per campus with least-recently-used removal, and asking the browser not to wipe our cache.

### Rendering
- Draw only the current step and current floor sketch. Long lists show only the rows on screen.
- **JSON + Brotli for now**; a binary format only if measurements show we need it.

---

## 9. Access restrictions (public vs. staff)

### ⚠️ Rule #1: hiding something in the app is not security
Restricted data **must never be inside public files**. It lives in separate chunks the server only sends to users who are logged in **and** have the permission.

### Public base + permission layers
```
Floor 2 public chunk          → everyone
Floor 2 + "electrical" layer  → panel room, service corridor
Floor 2 + "network" layer     → server room, network closets
Floor 2 + "icu-staff" layer   → staff-only shortcut
```
- Layers **add** checkpoints/connections onto public checkpoints. The app merges the allowed layers into one graph. The router doesn't know the difference.
- Public routes **can never** pass through restricted connections (they aren't on the visitor's phone).
- Staff get routes that use staff shortcuts.

### Visibility levels (proposed)
| Level | Public sees | Example |
|---|---|---|
| **Public** | Everything, can navigate | OPD, Pharmacy |
| **Visible but locked** 🔒 | Name + door, "Staff only", route ends at the door | ICU, Operating theatre |
| **Hidden** | Nothing | Electrical room, server room, medicine store |

### Who gets access
- **Roles → permissions** to start (Electrician → electrical layer, IT → network layer).
- Behind an `AccessPolicy` interface → later **time and circumstance rules** ("ward access only during my shift", visitor hours).
- **Login:** phone OTP for staff; organization single sign-on later.
- Restricted chunks are served through **short-lived signed links** (expire in minutes).

### Offline caching of restricted data
- Expires after a set time (e.g. one shift), then needs refreshing online.
- Deleted on logout or when access is revoked.
- A per-room setting: "too sensitive to cache".

### Trade-offs
1. Staff shortcuts change portal distances → **precompute per role** (a few per building), not per permission combination.
2. **Emergency mode** (future): show staff exits to everyone in a fire? The policy design allows it, but **the hospital decides**.

### Legal / sales note
**We control who sees information and directions, not physical access.** Locks and guards still guard doors. Put this in sales materials and contracts.

---

## 10. Production concerns
- **Isolation between customers:** Hospital A never sees Hospital B, enforced in the database itself (row-level security), not only in our code.
- **Audit log:** map edits and access to restricted layers.
- **Accessibility:** large tap targets, high contrast, screen-reader labels, **step-free routes** (wheelchair).
- **Testing:**
  - Unit tests on routing and access logic.
  - End-to-end tests on **simulated 2G + slowed-down CPU**.
  - Size budgets checked in CI.
- **Analytics while offline:** events stored on the phone, sent in a batch when a connection returns.

---

## 11. Roadmap (proposed)

| Version | Scope |
|---|---|
| **v0 (MVP)** | Visitor app (QR → destination → checkpoints → rescan to re-route, offline cache) · admin editor (floor-plan image → checkpoints + connections → publish + printable QR sheets) · sample building · size checks |
| **v1** | WhatsApp bot · Hindi + 1 regional language · directions links in appointment messages · staff edit from phone · access layers + staff OTP login · analytics |
| **v2** | AI mapping from photos of evacuation plans · reading door signs with the camera · step counting · animations |
| **Later** | Asset tracking upsell · emergency mode · organization single sign-on · kiosk mode |

**Tech stack (tentative):** TypeScript everywhere · visitor = plain TypeScript (no framework) · admin = Preact/React · Postgres (possibly Supabase) · Cloudflare Pages/CDN for static data.

---

## 12. Open decisions ❓

1. Is **"visible but locked"** the right middle level, or should restricted rooms always be fully hidden?
2. **Staff login:** phone OTP to start? (costs a little per SMS)
3. **Size budget:** visitor app ≤ 35 KB + 3–10 KB per floor chunk. Agree?
4. **City/region** and the **first pilot site** (a college or hospital?).
5. Founder's **skills/stack comfort** and **time per week**.
6. **Money:** bootstrapped or raising? Any deadline (hackathon, incubator, semester)?
7. Do we have **floor plans** for the pilot (PDF / CAD / photos)?
8. Should we do a proper **web-researched competitor teardown** (pricing, customers, funding, Indian competitors)?
