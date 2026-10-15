# Inner Map

Indoor navigation for campuses — colleges, hospitals, factories. Scan a QR sticker, pick a destination, follow landmark-based steps. No hardware, no app install, works offline on cheap phones.

## Design docs

| Doc                                                                  | Answers                               |
| -------------------------------------------------------------------- | ------------------------------------- |
| [`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md)                 | Why — business and product decisions  |
| [`docs/HIGH_LEVEL_ARCHITECTURE.md`](docs/HIGH_LEVEL_ARCHITECTURE.md) | What — the big pieces                 |
| [`docs/LOW_LEVEL_DESIGN.md`](docs/LOW_LEVEL_DESIGN.md)               | How — formats, interfaces, algorithms |
| [`docs/TECH_STACK.md`](docs/TECH_STACK.md)                           | Which tools, and why                  |
| [`docs/PROTOTYPE.md`](docs/PROTOTYPE.md)                             | What we build first                   |
| [`docs/PHASES.md`](docs/PHASES.md)                                   | In what order                         |

## Layout

```
packages/core     pure routing + directions logic (no browser/server code)
packages/schema   map file format, versions, validation
apps/visitor      ultra-light phone app (plain TypeScript, ≤ 35 KB)
apps/editor       drag-and-drop map editor (Preact)
tools/            size budget check
samples/          demo buildings
```

## Getting started

Requires Node 24 (see `.nvmrc`) and pnpm 10.

```sh
pnpm install
pnpm dev            # visitor on :5173 (also on your LAN for phone testing), editor on :5174
```

| Command                  | Does                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `pnpm test`              | Unit tests (Vitest)                                                                            |
| `pnpm lint`              | ESLint + layer rules (dependency-cruiser)                                                      |
| `pnpm typecheck`         | TypeScript in every package                                                                    |
| `pnpm build`             | Build both apps                                                                                |
| `pnpm size`              | Fail if the visitor app is over 35 KB compressed                                               |
| `pnpm check`             | Everything above, as CI runs it                                                                |
| `pnpm e2e`               | Browser tests: visitor (2G + slow CPU, airplane mode, resume) and editor (draw with the mouse) |
| `pnpm route <from> <to>` | Try a route on the demo map, e.g. `pnpm route G-MAIN Radiology --step-free`                    |
