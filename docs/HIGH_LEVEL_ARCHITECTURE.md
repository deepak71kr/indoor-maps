# Inner Map — High-Level Platform Architecture

> Platform for indoor navigation across **many campuses and industries**: colleges, hospitals, factories, malls, airports…
> Companion to [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md). Started: 2026-10-15 · Status: **design (proposed)**

---

## 0. Principles that must be right from day 1

These are expensive or impossible to change later:

1. **Organization id on every row**, separated by Postgres row-level security.
2. **Permanent QR links.** Every printed QR goes through our resolver and must work for 10+ years.
3. **Editing ≠ delivery.** Admins edit drafts; visitors only read compiled, read-only static files.
4. **A version number on the data format**, plus converters from old versions.
5. **Restricted data never goes inside public files.** It lives in separate chunks served through signed links.
6. **The visitor side never depends on our servers.** If the backend is down, navigation still works.
7. **One core engine plus industry packs.** Never fork the code per customer.

Everything else can wait until it's needed.

---

## 1. Platform layers: one engine, configured per industry

```mermaid
flowchart TB
    subgraph PACKS["INDUSTRY PACKS — data + config, not code forks"]
        direction LR
        H["🏥 Hospital<br/>OPD, Wards, Labs<br/>step-free routes<br/>appointment system"]
        C["🎓 College<br/>Classrooms, Hostels<br/>Faculty / Student roles<br/>timetable / ERP"]
        F["🏭 Factory<br/>Sheds, Control rooms<br/>hazard + PPE zones<br/>contractor access"]
        M["🏬 Mall / Airport / ...<br/>future packs"]
    end

    subgraph CORE["CORE ENGINE — same for every customer"]
        direction LR
        G["Spatial graph"]
        R["Router"]
        A["Access policy"]
        I["Directions builder"]
        P["Publishing<br/>(chunks + portals)"]
        Q["QR anchors"]
        AN["Analytics"]
        L["i18n"]
    end

    PACKS -->|"configures + plugs in rules"| CORE
```

| | 🏥 Hospital | 🎓 College | 🏭 Factory |
|---|---|---|---|
| Categories | OPD, Wards, Labs, Pharmacy | Classrooms, Labs, Hostels, Library | Sheds, Stores, Control rooms, Assembly points |
| Default roles | Doctor, Nurse, Electrician, Visitor | Faculty, Student, Guard | Operator, Maintenance, Contractor, Safety officer |
| Route rules | Step-free / stretcher-width | — | Avoid hazard zones, PPE zones, forklift lanes |
| Integrations | Hospital management system (appointments) | Timetable / ERP | Shift system, contractor induction |

**Rule against forking:** if 2+ customers need it, it goes into the core or a pack as configuration. If 1 customer needs it, it becomes an integration or webhook. **Never a customer-specific code branch.**

---

## 2. System components

```mermaid
flowchart LR
    subgraph USERS["Users"]
        V["📱 Visitor<br/>(anonymous)"]
        W["💬 WhatsApp user"]
        S["👷 Staff<br/>(logged in)"]
        AD["🧑‍💼 Customer admin"]
        PT["🤝 Partner<br/>(signage / facility mgmt)"]
    end

    subgraph EDGE["VISITOR SIDE — must always work"]
        QR["QR resolver<br/>inmp.in/q/ID<br/>(permanent links)"]
        CDN["CDN<br/>app + manifest + chunks<br/>(static, immutable)"]
        BOT["WhatsApp bot"]
    end

    subgraph BACKEND["BACKEND — modular monolith"]
        direction TB
        ACC["Accounts & users<br/>customers, roles, SSO"]
        AUTH["Map authoring<br/>drafts, validation"]
        PUB["Publishing compiler"]
        ACCESS["Access &<br/>signed links"]
        INT["Integrations<br/>WhatsApp, SMS, hospital systems, ERP"]
        BILL["Billing &<br/>plan limits"]
        ING["Analytics<br/>collection"]
    end

    subgraph DATA["Data (India region)"]
        DB[("Postgres<br/>+ row-level security")]
        JOBS[["Job queue<br/>publish, AI mapping, reports"]]
        OBJ[("Object storage<br/>published versions")]
        AS[("Analytics store")]
    end

    V -->|scan| QR --> CDN
    V -->|"offline after first visit"| CDN
    W --> BOT -->|reads published data| CDN
    S -->|login| ACC
    S -->|"restricted chunks"| ACCESS -->|signed link| CDN
    AD --> AUTH
    PT --> AUTH
    AUTH --> DB
    AUTH -->|publish| JOBS --> PUB
    PUB --> OBJ --> CDN
    ACC --> DB
    BILL --> DB
    INT --> BOT
    V -.->|"events, batched when online"| ING --> AS
```

### Why a modular monolith (not microservices)
- One backend codebase, one deployment, **strict module boundaries**: each module exposes an interface, and nothing reaches into another module's tables.
- With 2 founders, microservices = 10 deployments and endless DevOps work.
- Modules can be split out later when volume needs it (analytics first). Because the boundaries are clean, that's mechanical work, not a rewrite.

---

## 3. Editing vs. delivery (write once, read millions of times)

```mermaid
flowchart LR
    subgraph WRITE["FEW WRITES"]
        ED["Admin console<br/>edit draft"]
        DR[("Draft in Postgres<br/>editable")]
    end

    subgraph COMPILE["PUBLISH = COMPILE"]
        direction TB
        S1["1. Validate<br/>reachability, dead ends,<br/>missing landmarks, long gaps"]
        S2["2. Chunk per floor<br/>+ portal distances per role"]
        S3["3. Search index per language<br/>+ split restricted layers"]
        S4["4. QR codes + content fingerprints"]
        S1 --> S2 --> S3 --> S4
    end

    subgraph READ["MILLIONS OF READS"]
        MF["manifest vN"]
        CK["chunks<br/>(cached forever)"]
        PH["📱 phones<br/>(offline cache)"]
    end

    ED --> DR -->|publish| S1
    S4 -->|upload + switch manifest| MF
    S4 --> CK
    MF --> PH
    CK --> PH
    MF -.->|"rollback = point to v(N-1)"| MF
```

**Business effect:** the cost of each extra visitor ≈ ₹0 (CDN only) → **margins grow as we scale**. One-click rollback, preview before publishing.

---

## 4. Customer data model (multi-tenant)

```mermaid
erDiagram
    ORGANIZATION ||--o{ SITE : owns
    ORGANIZATION ||--o{ USER : has
    ORGANIZATION ||--o{ ROLE : defines
    ORGANIZATION }o--|| INDUSTRY_PACK : uses
    ORGANIZATION }o--o| PARTNER : "managed by"
    SITE ||--o{ BUILDING : contains
    SITE ||--o{ QR_ANCHOR : has
    BUILDING ||--o{ LEVEL : has
    LEVEL ||--o{ SPACE : contains
    LEVEL ||--o{ CHECKPOINT : contains
    CHECKPOINT ||--o{ CONNECTION : "from / to"
    ROLE ||--o{ PERMISSION : grants
    PERMISSION ||--o{ ACCESS_LAYER : unlocks
    ACCESS_LAYER ||--o{ CHECKPOINT : includes
    USER }o--o{ ROLE : "assigned (per site)"
    SITE ||--o{ PUBLISHED_VERSION : publishes
```

- **Organization** = the paying customer (e.g. a hospital chain). **Site** = a campus or plant. **One contract can cover many sites**, and those are the big deals.
- Roles can be limited to specific sites ("Electrician at the Chennai site only").
- **Compatible with Apple's IMDF format** (venue → level → unit) so we can export to it.
- **Separation:** shared database + row-level security by default → dedicated database per customer for government/defense/enterprise later (possible because the organization id is everywhere).

---

## 5. Visitor flow: QR → navigate → re-route

```mermaid
sequenceDiagram
    actor V as 📱 Visitor
    participant QR as QR resolver
    participant SW as Phone cache<br/>(service worker)
    participant CDN as CDN

    V->>QR: scan sticker (inmp.in/q/7Hk2P)
    QR-->>V: redirect → site + checkpoint
    V->>SW: open app
    alt first visit
        SW->>CDN: app (~30 KB) + manifest (~5 KB)
        SW->>CDN: current floor chunk (~5 KB)
        CDN-->>SW: cache everything
    else already cached
        SW-->>V: instant, offline
    end
    V->>SW: choose destination "Radiology"
    SW->>CDN: destination floor chunk (if not cached)
    Note over SW: route = start floor + destination floor<br/>+ precomputed portal distances
    SW-->>V: step-by-step checkpoints
    SW->>CDN: download upcoming floors in background
    loop each checkpoint
        V->>SW: tap "✓ I'm here"
    end
    opt lost
        V->>QR: scan nearest QR / type room number
        QR-->>SW: new start point
        Note over SW: SAME saved destination → re-route
    end
    SW-)CDN: analytics events (batched when online)
```

---

## 6. Staff flow: restricted access

```mermaid
sequenceDiagram
    actor S as 👷 Electrician
    participant APP as Visitor/Staff app
    participant ACC as Accounts (OTP)
    participant ACCESS as Access service
    participant CDN as CDN (restricted bucket)

    S->>APP: "Staff login"
    APP->>ACC: phone OTP
    ACC-->>APP: short-lived token (role: Electrician, site: Chennai)
    APP->>ACCESS: request layers for Floor 2
    ACCESS->>ACCESS: AccessPolicy check<br/>(role, site, shift time)
    ACCESS-->>APP: signed links (expire in minutes)<br/>for "electrical" layer
    APP->>CDN: fetch restricted chunk
    CDN-->>APP: panel room + service corridor
    Note over APP: merge public + allowed layers<br/>→ router uses staff shortcuts
    Note over APP: offline cache expires after the shift<br/>deleted on logout / access revoked
```

**Visibility levels:**

```mermaid
flowchart LR
    PUB["🟢 Public<br/>everyone sees + navigates<br/>e.g. OPD, Pharmacy"]
    LOCK["🟡 Visible but locked 🔒<br/>name + door shown, route ends at door<br/>e.g. ICU, Operating theatre"]
    HID["🔴 Hidden<br/>not in public files at all<br/>e.g. Electrical, Server room"]
    PUB --- LOCK --- HID
```

> ⚠️ We control **who sees information and directions**, not physical access. Locks and guards still guard doors.

---

## 7. Data delivery for huge campuses

```mermaid
flowchart TB
    MAN["📄 Campus manifest (~3–8 KB)<br/>buildings · entrances · outdoor paths<br/>portals (lifts, stairs, connecting doors)<br/>⭐ precomputed portal distances per floor + role<br/>top ~50 destinations · chunk fingerprints"]

    MAN --> FA["Building A · Floor 1 chunk"]
    MAN --> FB["Building A · Floor 2 chunk"]
    MAN --> FC["Building C · Floor 4 chunk"]
    MAN --> SI["🔎 Search index chunks<br/>(per building, per language)"]
    FB --> RL["🔒 Restricted layer chunks<br/>(signed links only)"]

    subgraph ROUTE["Route A-F1 → C-F4 needs only:"]
        direction LR
        X1["start floor chunk"] --> X2["manifest portals<br/>(floors in between + outdoor)"] --> X3["destination floor chunk"]
    end
```

- Small buildings = **1 file** (on 2G, the number of requests matters more than size). Big campuses = split. The publishing step decides automatically.
- **Download ahead:** the route's floors + floors connected by lifts/stairs. **Data Saver / 2G** → only what's needed right now.
- **Content fingerprints in filenames** → cached forever. An edit = only the changed chunk is downloaded again.

---

## 8. Permanent QR links

```mermaid
flowchart LR
    STK["🏷️ Printed sticker<br/>inmp.in/q/7Hk2P<br/>+ short code F2-J3"] --> RES{"QR resolver"}
    RES -->|active| GO["current site + checkpoint<br/>(remapped if the building changed)"]
    RES -->|customer left| OFF["'This map is no longer active'<br/>(stops link takeover / scams)"]
    RES -->|unknown ID| ERR["friendly error + report"]
```

- QR codes **always** go through our short domain, even when the customer has a branded domain for their web links.
- The building is renovated → update the mapping, **never reprint stickers**.

---

## 9. Extension points (how industries plug in)

```mermaid
flowchart LR
    CORE(("Core engine"))
    CORE --- RC["RouteCostRule<br/>step-free · avoid hazard · PPE"]
    CORE --- AP["AccessPolicy<br/>roles · shifts · visiting hours"]
    CORE --- DP["DestinationProvider<br/>appointment · work order · timetable"]
    CORE --- NT["Notifier<br/>WhatsApp · SMS · safety briefing"]
    CORE --- PS["PositionSource<br/>QR · room number · machine plate · camera (v2)"]
```

New industry = **new pack + maybe 1–2 new implementations**. The core stays untouched (Open/Closed principle).

---

## 10. Reliability: what breaks when the backend is down

```mermaid
flowchart LR
    DOWN["💥 Backend outage"]
    DOWN -->|"✅ unaffected"| OK1["Visitor navigation<br/>(CDN + phone cache)"]
    DOWN -->|"✅ unaffected"| OK2["QR scans"]
    DOWN -->|"⚠️ until expiry"| OK3["Staff with cached restricted layers"]
    DOWN -->|"❌ paused"| NO1["Admin editing / publishing"]
    DOWN -->|"❌ paused"| NO2["New staff logins"]
    DOWN -->|"⏳ queued on phones"| NO3["Analytics events"]
```

> Selling point: **"Our outages don't strand patients in your corridors."**

---

## 11. Data protection & compliance (India-first)

- **Minimal personal data:** visitors are anonymous; analytics are anonymous events → light obligations under the **DPDP Act, 2023**.
- **No medical data ever:** hospital integrations pass only "destination = OPD 12".
- **Data hosted in India** (Mumbai cloud region).
- **Self-hosted edition (later):** the visitor side is static → a bundle that runs on the customer's internal network (defense / high-security factories).
- Audit logs, staff access reviews, role-based admin access for enterprise sales checklists.

---

## 12. Business needs built into the architecture

```mermaid
flowchart LR
    PLAN["Plan limits service"] --> F1["sites / floors / staff seats"]
    PLAN --> F2["WhatsApp message quota"]
    PLAN --> F3["feature flags<br/>analytics, access layers, integrations"]
    PARTNER["🤝 Partner accounts"] -->|"manage many customers"| ORGS["Organizations"]
    API["Public API + webhooks"] -->|"one-off needs without forks"| ORGS
```

- **Pricing units:** main price per **site per month** · usage: **WhatsApp messages** (Meta charges per conversation, passed through with a margin) · add-ons: staff access layers, analytics, integrations.
- **Self-serve** for small colleges/clinics · **assisted onboarding** for chains and factories.
- **Partner channel:** signage, facility-management and fire-safety firms resell and do the mapping, which grows us without sales staff.

---

## 13. Build in stages

```mermaid
flowchart LR
    S1["<b>Stage 1 — Prove it</b><br/>1–5 pilots<br/>static app on CDN · one backend<br/>Postgres + row-level security<br/>QR resolver from day 1<br/>manual onboarding"]
    S2["<b>Stage 2 — Repeatable</b><br/>10–100 customers<br/>self-serve signup · publishing checks<br/>WhatsApp · plan limits<br/>first industry packs · dashboards"]
    S3["<b>Stage 3 — Scale</b><br/>100–1,000+<br/>partner accounts · SSO<br/>dedicated DBs for enterprise<br/>split analytics · self-hosted<br/>public API"]
    S1 --> S2 --> S3
```

---

## 14. Tentative tech choices

| Area | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language, shared `packages/core` |
| Visitor app | Plain TypeScript, no framework | first screen ≤ 50 KB |
| Admin console | Preact / React | Staff use laptops; richer editor |
| Backend | Node.js / TypeScript modular monolith | Shares routing code with the client |
| Database | Postgres (India region) + row-level security | Customer separation enforced by the database |
| Edge / CDN | Cloudflare (Pages / Workers / R2) or similar | Static delivery, signed links, QR resolver at the edge |
| Jobs | Postgres-backed queue to start | No extra infrastructure at Stage 1 |
| Analytics | Postgres partitions → columnar store later | Don't over-build early |

---

## 15. Open decisions ❓

1. **First revenue industry** after the college pilot: hospitals or factories?
2. **Short QR domain + brand name** (buy early, e.g. `inmp.in`).
3. **Self-hosted edition:** real customer need now, or later?
4. **First partners:** any signage / facility-management contacts?
5. Cloud provider choice for the India region.
