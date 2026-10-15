# Demo Hospital (sample map, format 0)

A small, hand-written 3-floor hospital used by tests and for trying the apps. Every floor shares the same corridor skeleton; coordinates are in meters (x → east, y → south).

```
            x=5          x=18          x=30          x=42          x=55
 y=10      [LB]
            |
 y=12       |          [N18]         [N30]         [N42]
            |            |             |             |
 y=15      (W)─────────(C18)─────────(C30)─────────(C42)─────────(E)
            |            |             |             |             |
 y=18      [SW]        [S18]           |           [S42]           |
            |                          |                          [ST]  y=20
            |                        (LOB)──[LA]                         y=22
 y=26     [ENT2]                       |
 y=28   (G only)                     [ENT]  (G only, ramp)
```

`(…)` corridor junctions · `[…]` doors / stops · LA = Lift A · LB = Lift B · ST = East staircase

## What's on each floor

| Spot | Ground (teal)                                | Floor 1 (amber)          | Floor 2 (violet)              |
| ---- | -------------------------------------------- | ------------------------ | ----------------------------- |
| N18  | Billing counter G01                          | OPD 101 General Medicine | **Radiology 201 (main door)** |
| S18  | Canteen G02                                  | OPD 102 Orthopaedics     | Pathology lab 203             |
| N30  | Pharmacy G03                                 | OPD 103 ENT              | **Radiology 201 (side door)** |
| N42  | X-Ray G04                                    | OPD 104 Paediatrics      | MRI 202                       |
| S42  | Blood bank G05                               | Sample collection 106    | CT scan 204                   |
| SW   | **Emergency G06** (also reachable from ENT2) | OPD 105 Eye              | Doctors' lounge 205 🔒        |

## Test cases built in

| Case                         | Where                                                 |
| ---------------------------- | ----------------------------------------------------- |
| Lift that **skips a floor**  | Lift B stops at Ground and Floor 2 only               |
| Room with **2 doors**        | Radiology (2-N18, 2-N30), Emergency (G-SW, G-ENT2)    |
| **Two entrances**            | Main Entrance (G-ENT), Emergency entrance (G-ENT2)    |
| **Ramp**                     | G-LOB ↔ G-ENT                                         |
| **Staff-only (locked) room** | Doctors' lounge                                       |
| Lift vs. stairs choice       | Lift A (centre) vs. East staircase                    |
| Nearest amenity              | Toilets at G-E, 1-E; accessible toilets at G-LOB, 2-W |

## QR stickers

| Code                     | At                    | Reader faces     |
| ------------------------ | --------------------- | ---------------- |
| G-MAIN                   | Main Entrance         | 0° (north)       |
| G-EMR                    | Emergency entrance    | 0°               |
| G-LIFT                   | Lift A lobby, Ground  | 90° (east)       |
| G-EAST / G-WEST          | Corridor ends, Ground | 90° / 270°       |
| 1-LIFT / 1-EAST          | Floor 1               | 90°              |
| 2-LIFT / 2-WEST / 2-EAST | Floor 2               | 90° / 270° / 90° |
