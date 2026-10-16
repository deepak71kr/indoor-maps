# Demo Tech Campus (Mesra-style) — big stress-test sample

A large, **fictional** campus loosely inspired by big Indian engineering colleges such as BIT Mesra. It is not a real map of any campus — it exists to test the apps at full size.

**Generated, not hand-written:** edit `generate.mjs`, then run

```
node samples/demo-mesra/generate.mjs
```

## What's in it

| Area              | Places                                                                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gates and roads   | Main Gate (south), Back Gate (north-east), Main Avenue, Gate Road, Academic Avenue, Hostel Road, West / East Road, Girls Hostel Lane; named crossings (Gate Circle, Library Chowk, Hostel Chowk…)     |
| Academic          | Main Building (3 floors: admissions, accounts, director, placement, science depts), Lecture Hall Complex (2), CSE / ECE (3), Mechanical / Civil (2) with labs, classrooms, faculty rooms, HOD offices |
| Library and halls | Central Library (2 floors, digital library), Auditorium                                                                                                                                               |
| Hostels           | Hostel 1–5 and Girls Hostel 1–2 (3 floors each: warden office, common room, room wings)                                                                                                               |
| Food              | Central Mess, Food Court, Night Canteen, juice / bakery shops                                                                                                                                         |
| Health and sports | Medical Centre (Dispensary, 2 floors: OPD, pharmacy, emergency, ward, X-ray), Sports Complex (2), Aquatic Centre + Swimming Pool, Football and Cricket Grounds                                        |
| Services          | Shopping Complex, Bank & Post Office, ATM Kiosk, Guest House, Security & Visitor Centre, Staff Quarters A–D, Temple                                                                                   |
| Utilities         | Electrical Substation 🔒, Water Pump House 🔒, Water Tank, server / control rooms 🔒                                                                                                                  |
| Outdoors          | Main Lawn, Campus Lake, Herbal Garden, 4 parking areas, ~250 trees along the avenues                                                                                                                  |

**Size:** 33 buildings, 32 floors, ~1,800 dots, 808 rooms; 31 KB brotli in **one file**. That is over the 15 KB per-map budget on purpose. Real sites this big are published per building (v0 on-demand loading). `tools/size-check.mjs` gives this file its own 40 KB stress budget and leaves it out of the first-visit total.

## Test cases built in

| Case                       | Where                                                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Several doors per building | Main Building, Lecture Hall Complex, Library, Central Mess, Shopping Complex, Guest House and all four departments have a front door plus **west and east doors**; routes use whichever is nearer (stickers `<CODE>-W` / `<CODE>-E`) |
| Two staircases             | Every long multi-floor building has stairs at both ends ("… east stairs")                                                                                                                                                            |
| Two lifts                  | Main Building: Lift (west) and Lift B (east)                                                                                                                                                                                         |
| Road closed for works      | West Road between Sports Junction and the Water Pump House path (red dashes); every route goes around it, e.g. `SPC-ENT` → Water Pump House                                                                                          |
| Visitor reports a blockage | While walking, tap **🚧 Path blocked?** → a new way round from where you stand                                                                                                                                                       |
| Fastest vs shortest        | Route preview: ⚡ Fastest (lift waits, slow stairs) or 📏 Shortest (meters only), plus step-free                                                                                                                                     |

## Try it

- Phone: `http://localhost:5173/?site=demo-mesra&at=MAIN-GATE`. Other stickers: `BACK-GATE`, `<CODE>-ENT` at every entrance (e.g. `CSE-ENT`, `H3-ENT`, `MED-ENT`), and `<CODE>-<floor>` at every lift lobby (e.g. `MB-2`).
- Terminal: `pnpm route MAIN-GATE "AI & ML Lab" --map samples/demo-mesra/map.json`
- Editor: **Import** `samples/demo-mesra/map.json`.
