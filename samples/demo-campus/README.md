# Demo College (sample campus, format 0)

A small hand-written campus used by tests and for trying the apps (Phase 10 — campus view). Coordinates are in meters (x → east, y → south) and shared by every floor.

```
                 ┌──── Library ────┐   ┌──── Sports ground ────┐
                 │ Reading │ Stacks │   │                       │
                 │  hall   │  [ST]  │   └───────────────────────┘
                 └──(LIB-ENT)───────┘
                         │ road           ┌───────── Block A ─────────┐
 ┌─── Admin Block ───┐   │                │ [Lift] Store  Exam  [ST]  │
 │ Admission │ Fees  │   │                │ (LOB)──(C1)──(C2)──(E)    │
 │ (C2)──(C1)──(LOB)─(ADM-ENT)──(J1)──(A-ENT)  Seminar hall │ Toilets │
 │ Principal │ WC    │   Fountain circle  └───────────────────────────┘
 └───────────────────┘   │
  [ Parking ]   West lawn│East lawn
                       (ROAD) notice board
                         │
                      (GATE)  Main gate · QR "GATE"
```

## How it is built

- **One shared Ground level** (`G`) holds the outdoors (roads, lawns, parking, building footprints) **and** the ground floor of every building, so walking in through a door is a normal line.
- **Upper floors belong to a building:** `A1`, `A2` (Block A, lift + stairs) and `L1` (Library, stairs only). Floor order is unique per building, so Block A and the Library each have a "Floor 1".
- Building entrances are entrance dots on the footprint wall: the phone cuts a door gap there and draws a green arrow pointing in.

## Try it

- Phone: `http://localhost:5173/?site=demo-campus&at=GATE` → search "computer" → follow the steps.
- Terminal: `pnpm route GATE A-204 --map samples/demo-campus/map.json`
- Editor: **Load campus**.

## Test cases built in

| Case                                  | Where                                            |
| ------------------------------------- | ------------------------------------------------ |
| Gate → room on another building's 2nd | GATE → Computer lab A-204 (road, entrance, lift) |
| Between buildings                     | QR "A2-LIFT" → Fees counter (Admin Block)        |
| Floors counted per building           | Block A lift G → Floor 2 rides 2 floors          |
| Step-free: no route                   | Digital library L-101 (Library has stairs only)  |
| Staff only 🔒                         | Principal's office, Staff room                   |

QR stickers: `GATE`, `ADMIN`, `A-LOBBY`, `A1-LIFT`, `A2-LIFT`, `LIBRARY`.
