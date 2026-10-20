# QR stickers

Ready-to-print QR stickers, one folder per site, made by `tools/make-qr.mjs` from the site's map.

- `bit-mesra/` — the BIT Mesra campus (`samples/demo-mesra`): 147 stickers in a folder per
  building (`mb` Main Building, `lib` Central Library, `h1` Hostel 1…) and `campus` for the gates.
  - `index.html` — every sticker on one page; print at 100 % (each is 60 × 90 mm).
  - `stickers.csv` — code, place, floor and link for each sticker (to plan where they go).
  - Each `<CODE>.svg` — one sticker: the QR (→ the visitor app at that spot), the big short code,
    "You are at …" and the floor, in the floor's colour.

Make them again after the map changes:

```sh
node tools/make-qr.mjs                                  # BIT Mesra → qr/bit-mesra/
node tools/make-qr.mjs samples/demo-hospital/map.json qr/hospital
```
