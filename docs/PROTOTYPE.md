# Inner Map — Prototype Plan

> First working version: a **drag-and-drop map editor** + a **visitor navigation app** we can test on a real phone in a real building.
> Companion to [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md) · [`HIGH_LEVEL_ARCHITECTURE.md`](./HIGH_LEVEL_ARCHITECTURE.md) · [`LOW_LEVEL_DESIGN.md`](./LOW_LEVEL_DESIGN.md) · [`TECH_STACK.md`](./TECH_STACK.md)
> Started: 2026-10-15 · Status: **plan, not started**

---

## 1. Goal

> **In simple words:** build the smallest thing that proves the idea works. **Draw a building in the editor → scan a QR on a phone → get walked to a room.** No server, no login, no payments yet.

The prototype must prove 4 things:

| # | Question we answer | How we know |
|---|---|---|
| 1 | Can a person map a real building **quickly**? | One person maps 2–3 floors in **under 2 hours** |
| 2 | Do **text + landmark directions** (no photos, no blue dot) actually work? | A stranger reaches **5 out of 5** destinations with no help |
| 3 | Is it **light and offline**? | First visit **≤ 50 KB**; the second visit works in **airplane mode** |
| 4 | Does **"lost → scan any QR → re-route"** feel natural? | Testers recover without being told how |

It's also our **demo for pitching** to colleges and hospitals.

---

## 2. What's IN and what's OUT

| ✅ In the prototype | ❌ Not yet (comes later) |
|---|---|
| Drag-and-drop map editor (runs in the browser) | Backend server, database |
| Multiple floors, lifts, stairs | Login, OTP, staff accounts |
| Rooms, doors, amenities (🚻 💧 🏧 …) | Real access control / secret layers |
| QR stickers with wall direction + printable sheet | Permanent QR resolver domain |
| Route preview inside the editor | Multi-customer platform, billing |
| Visitor app: search → steps → ✓ I'm here → lost → re-route → arrived | WhatsApp bot |
| Works offline (service worker) | Chunked loading for huge campuses (one file is fine for now) |
| Save / load the map as a JSON file | AI mapping from photos |
| English (Hindi as a stretch goal) | Analytics dashboard |

**Where the data lives in the prototype:**
- The editor saves to the browser (auto-save) + **Export / Import a `.json` file**.
- The visitor app reads that same exported file as a static file.
- "Publish" = **Export**.

---

## 3. What we keep vs. what we throw away

> **In simple words:** the "brain" we build now is the real one. The screens might be rebuilt later.

| Part | Fate | Why |
|---|---|---|
| `packages/core` (graph, routing, directions) | **Keep. Production quality from day 1**, with tests | It's the heart of the product and identical in the final version |
| `packages/schema` (data format + validation) | **Keep** (becomes `fmt: 1`) | Future versions convert from it |
| `apps/visitor` | **Keep and grow** | Already built to the real size budget |
| `apps/editor` | **May be rewritten** later as the full admin console | Speed matters more than perfection here |

---

## 4. Map data model (prototype subset)

> **In simple words:** a building = **floors** with a floor-plan picture, **dots** (path points) joined by **lines**, plus **rooms, lifts/stairs, amenities and QR stickers** attached to dots.

### Decisions used in the prototype
- **Two layers:** *path layer* (dots + lines, always needed) and *shape layer* (room outlines, optional). The prototype stores **rooms as name + door dot**; outlines come later.
- **Coordinates in meters.** Each floor's image gets a **scale** (admin draws a line over a known length). The prototype assumes **all floor images are already lined up** (same position/zoom). The alignment tool comes later.
- **Dots vs. checkpoints:** every dot is used for routing; only dots with a **landmark name** are shown to visitors as steps.
- **Distances are computed automatically** from positions. The admin never types meters.
- **Lift/stairs = one connector object** spanning several floors (a lift can skip floors). Lift = a line between every pair of its floors; stairs = between neighboring floors only.
- **QR stickers store the wall direction**, so the first instruction can say "With this sign in front of you, turn RIGHT".
- **Rooms can have several doors** → route to the closest one.

### File format (prototype, `fmt: 0`)
```json
{
  "fmt": 0,
  "site": { "id": "demo-hospital", "name": "Demo Hospital" },
  "levels": [
    { "id": "G", "name": "Ground", "ord": 0, "color": "teal",
      "image": "plans/ground.png", "pxPerMeter": 24.0 }
  ],
  "nodes": [
    { "id": "n1", "lvl": "G", "x": 12.0, "y": 40.0, "kind": "entrance", "landmark": "Main Entrance" },
    { "id": "n2", "lvl": "G", "x": 30.0, "y": 40.0, "kind": "junction", "landmark": "Reception desk (blue board)" },
    { "id": "n3", "lvl": "G", "x": 30.0, "y": 52.0, "kind": "lift-stop" }
  ],
  "edges": [
    { "a": "n1", "b": "n2", "kind": "walk" },
    { "a": "n2", "b": "n3", "kind": "walk", "tags": ["step-free"] }
  ],
  "connectors": [
    { "id": "L1", "kind": "lift", "name": "Lift A", "stops": { "G": "n3", "1": "n31", "2": "n52" } }
  ],
  "rooms": [
    { "id": "r1", "name": "Radiology", "number": "214", "category": "lab", "doors": ["n57", "n60"] }
  ],
  "amenities": [
    { "id": "a1", "kind": "toilet-accessible", "node": "n12" }
  ],
  "qr": [
    { "code": "G-E1", "node": "n1", "facing": 90 }
  ]
}
```
- `x`, `y` in **meters** (converted from pixels using `pxPerMeter`); x grows east (right), y grows south (down). `facing` = **the direction a person looks while reading the sticker**, in degrees clockwise from "up" on the plan (0 = north, 90 = east). The implemented format lives in `packages/schema/src/format-v0.ts`.
- Edge distance is **not stored**. It's calculated from the dot positions; lift/stairs costs come from the connector.
- **Campus (Phase 10, optional):** `"buildings": [{ "id": "a", "name": "Block A" }]`; a level with `"building": "a"` belongs to Block A, a level without one is shared by the site (the Ground level holds the outdoors plus every ground floor). Outdoor `shapes` kinds: `building` (footprint, `"building": "a"`), `road`, `green`, `parking`. See `samples/demo-campus`.

---

## 5. Editor (💻 drag-and-drop map builder)

### Screen layout
```
┌────────────────────────────────────────────────────────────────────────────┐
│ 🗺 Inner Map Editor   Demo Hospital ▾   [Import] [Export] [Print QR] [▶ Test]│
├──────────┬───────────────────────────────────────────────┬─────────────────┤
│ TOOLS    │  Floors: [ Ground ] [ 1 ] [ 2 ] [+]            │ PROPERTIES      │
│          │ ┌───────────────────────────────────────────┐ │                 │
│ ↖ Select │ │   (floor-plan image, faded)                │ │ Dot n2          │
│ ✏ Path   │ │                                            │ │ Kind: junction  │
│ 🚪 Door   │ │    ●━━━━━━━●━━━━━━━━━●                     │ │ Landmark:       │
│ 🏷 Room   │ │    ┃       ┃         ┃                     │ │ [Reception desk]│
│ 🛗 Lift   │ │    ●       ●━━━━🛗   ●━━ 🚪 Radiology     │ │ (blue board)    │
│ 🪜 Stairs │ │                                            │ │                 │
│ 🔳 QR     │ │       🚻        💧                          │ │ ⚠ 2 issues      │
│ 📏 Scale  │ └───────────────────────────────────────────┘ │ • Room 7 has    │
│──────────│  zoom − ▢ +    snap: on    grid: off          │   no door       │
│ AMENITIES│                                               │ • Dot n9 has no │
│ drag ▶   │                                               │   landmark name │
│ 🚻 💧 🏧 ☕│                                               │                 │
│ 💊 ♿ 🧯 🛐│                                               │                 │
└──────────┴───────────────────────────────────────────────┴─────────────────┘
```

### Tools and how they feel
| Tool | How it works |
|---|---|
| 📏 **Scale** | Draw a line over something you know (a door ≈ 0.9 m) → type the meters → the floor gets its scale |
| ✏ **Path** | Click, click, click along corridors → dots + lines appear. **Clicking near an existing dot snaps to it** (that's how paths join). Double-click / Esc to finish |
| ↖ **Select** | **Drag dots to move them** (connected lines follow, distances update). Click a line to set its type/tags. Delete key removes |
| 🚪 **Door** | Click on a path dot or near a path → creates a door dot linked to the nearest path |
| 🏷 **Room** | Click a door → give it a name, number, category. Add more doors to the same room |
| 🛗 **Lift / 🪜 Stairs** | Drop on the map → choose which floors it serves → it appears on those floors (same position) → connect it to paths on each floor |
| 🔳 **QR** | Drop on a dot → **drag the arrow to point at the wall** → a code is generated (e.g. `G-E1`) |
| **Amenities** | **Drag an icon from the palette onto the map** → it snaps to the nearest dot |

### Must-have editor features
- **Floor tabs** with the floor color; other floors shown faintly for reference.
- **Undo / Redo** (Ctrl+Z / Ctrl+Y). Every action is a "command" object, which also helps later (history, collaboration).
- **Auto-save** to the browser every change + **Export / Import** `.json`.
- **Live checks panel:** unreachable dots, rooms with no door, steps without landmark names, very long lines (> 30 m), lifts serving only 1 floor, duplicate QR codes. **Clicking an issue zooms to it.**
- **▶ Test route mode:** click a start and a destination → the path is highlighted across floors and **the exact visitor steps are shown in the side panel**. Same `core` code as the phone.
- **Print QR:** an A4 page of stickers, each with: QR → `/?at=G-E1`, the short code in big text, the floor color, and "Scan for directions".

### Tech (from TECH_STACK)
Preact + Vite · SVG drawing on top of the floor-plan image · zoom/pan with mouse wheel/drag · `qrcode` for stickers · uses `packages/core` for checks and test routes.

---

## 6. Visitor app (📱 the real experience)

### Screens
```
 1. ARRIVE                    2. STEP                      3. LOST                 4. ARRIVED
┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐ ┌──────────────────┐
│ 🏥 Demo Hospital      │   │ 🟣 Floor 2  Step 3/5  │   │ 😕 Let's find you     │ │      🎉           │
│ 📍 Main Entrance      │   │ ●●●○○                │   │                      │ │ You've reached   │
│                      │   │        ↰             │   │ [🔳 Scan nearest QR] │ │ RADIOLOGY        │
│ 🔍 Where to?          │   │ Turn LEFT at the     │   │                      │ │ on your RIGHT    │
│ ┌──────────────────┐ │   │ 💊 PHARMACY counter   │   │ Room number on the   │ │                  │
│ │ Search room...   │ │   │ (green board)        │   │ nearest door:        │ │ [New destination]│
│ └──────────────────┘ │   │                      │   │ [ 2__ ] [Go]         │ │ [🚻 Nearest toilet]│
│ 🧪 Labs   🩺 OPD      │   │ ┌──────────────────┐ │   │                      │ └──────────────────┘
│ 💊 Pharmacy 🚻 Toilet │   │ │   ✓  I'm here    │ │   │ Do you see any?      │
│ ♿ Step-free route ○  │   │ └──────────────────┘ │   │ • Lift A             │
└──────────────────────┘   │ 😕 Lost · ← Back · 🗺 │   │ • Canteen (yellow)   │
                           └──────────────────────┘   └──────────────────────┘
```

### Behavior
- Opened by a QR link: `/?at=G-E1` → start point known. Opened with no `at` → "Where are you?" (type a room number / pick from a list).
- **Search** by name, room number or category. "Nearest 🚻" / "Nearest 💧" search from where you are.
- **♿ Step-free toggle** → no stairs.
- **Steps** follow the LLD rules: merge straight parts, turn by angle, **always name a landmark**, floor change = 3 steps, first step uses the QR wall direction.
- **Session saved on the phone** (3-hour expiry) → closing the browser doesn't lose the trip.
- **Scanning another QR mid-route → re-route to the same destination.**
- **Offline:** a service worker caches the app + map file after the first visit.
- **🗺 Mini map (stretch):** an SVG sketch of the current floor with the route line.

### Size budget (same as production)
App shell ≤ **35 KB** compressed · map file for the demo building ≤ **15 KB** compressed · checked by a script.

---

## 7. Repo structure for the prototype

```
inner-map/
├─ packages/
│  ├─ core/            # graph, A* routing, directions, nearest-amenity, validation  ← KEEP
│  └─ schema/          # fmt:0 types + validation (Zod)                            ← KEEP
├─ apps/
│  ├─ visitor/         # plain TS + service worker                                 ← KEEP
│  └─ editor/          # Preact + SVG editor
├─ samples/
│  └─ demo-hospital/   # map.json (3 floors) + floor-plan images later
├─ tools/
│  └─ size-check.mjs
└─ docs/            # design docs (this file and its companions)
```
pnpm workspaces · TypeScript strict · Vitest · ESLint + Prettier. No backend.

---

## 8. Milestones

Each one ends with something we can **see and try**. The detailed task-by-task breakdown is in [`PHASES.md`](./PHASES.md).

| # | Milestone | Done when… |
|---|---|---|
| **M0** | Repo setup | `pnpm dev` runs both apps; lint, tests and size check run |
| **M1** | Core brain | Given the sample JSON, tests show correct routes across floors, step-free routes, nearest toilet, and readable step text |
| **M2** | Visitor app (on a hand-written sample map) | On a phone: open `/?at=G-E1` → search → follow steps → lost → re-route → arrived |
| **M3** | Editor basics | Upload 3 floor plans → set scale → draw paths → drag dots → doors + rooms → lifts/stairs → export a file the visitor app can use |
| **M4** | Editor polish | Amenity drag-and-drop · QR placement with wall direction · printable QR sheet · live checks · ▶ test route · undo/redo |
| **M5** | Offline + real-world test | Service worker; app + map ≤ 50 KB; **map a real building (your college?) and test with 5 strangers** |
| **M6** | Stretch goals | Hindi · mini map sketch · "Remember my parking spot" · "staff-only" demo toggle (clearly a demo, not real security) |

**Order matters:** core first (M1), then the visitor app on a hand-made map (M2), *then* the editor. That way we know the experience works before investing in the tool.

---

## 9. Real-world test plan (M5)

1. **Pick a building:** 2–3 floors, a lift and stairs, ~20 destinations.
2. **Map it** with the editor. ⏱ Measure the time (target < 2 hours).
3. **Print and stick** 10–15 QR codes (entrance, lifts, main junctions), with permission.
4. **5 testers** who don't know the building, each given 5 destinations (1 on another floor, 1 "nearest toilet", 1 where they start with no QR).
5. **Watch silently and note:** where they hesitate, which landmark names confused them, whether they found "I'm lost".
6. **Test on a cheap Android phone** with mobile data limited to 2G/3G, then in airplane mode for the second visit.
7. **Write the findings** in `PROTOTYPE.md` → feeds v0 decisions.

---

## 10. Pitch demo script (2 minutes)

1. "This is your hospital's floor plan." → draw a corridor, drop a lift, drag a 🚻 → **"that's how fast mapping is."**
2. Press ▶ Test: Entrance → Radiology on Floor 2 → show the steps.
3. Hand them a phone: scan the printed QR → follow 2 steps → tap **I'm lost** → scan another QR → **re-routed instantly**.
4. Turn on **airplane mode** → it still works.
5. "No beacons. No app. A few rupees of stickers. Live in a day."

---

## 11. Open questions ❓

1. **Which real building** will we map for M5? (Your college?)
2. Do we have **floor-plan images** for it, or will we photograph the fire-evacuation plans?
3. **Hindi in the prototype** (M6), or English only until the pilot?
4. Should we deploy the prototype on **Cloudflare Pages** (a real link for demos) or keep it on our laptops + phone on the same Wi-Fi?
