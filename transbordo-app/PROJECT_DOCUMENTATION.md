# transbordo-app — End-to-End Technical Documentation

## 1) Purpose & Problem Statement

**transbordo-app** is a web application for logging and auditing “Transbordo de Glicerina” operations in a plant/yard environment. The operation requires recording **time intervals**, the **pump used (Bomba 1/2)**, **shift** rules, and **operational context** (productive vs. waiting/maintenance reasons). The app replaces ad-hoc notes/spreadsheets with a consistent, validated dataset that can be filtered and exported to CSV.

### Target users

- **Operators (OPERADOR)**: create records for their own work and review their own history.
- **Supervisors (SUPERVISOR)**: review and export all records.
- **Admins (ADMIN)**: maintain the **Client** list used by the “Produtivo” workflow and can manage visibility/exports.

Roles are represented by the `Role` type in [`transbordo-app/src/App.tsx`](transbordo-app/src/App.tsx:26).

---

## 2) System Overview

This is a **single-page application (SPA)** built with **React + TypeScript + Vite**, hosted on **Firebase Hosting**, with:

- **Firebase Authentication** (email/password)
- **Cloud Firestore** for data storage (`users`, `events`, `clients`)
- **Firestore Security Rules** controlling access

### High-level components

- UI routing: [`App()`](transbordo-app/src/App.tsx:156) defines routes for `/login` and `/app`.
- Auth bootstrap + role provisioning: [`ensureUserProfile()`](transbordo-app/src/App.tsx:131).
- Main application page: [`FieldPage()`](transbordo-app/src/App.tsx:344) (event entry + history + admin client management).
- Hosting config: [`firebase.json`](firebase.json:1)
- Firestore rules: [`firestore.rules`](firestore.rules:1)

### What Firebase Hosting serves

Firebase Hosting serves the static build output from:

- [`firebase.json`](firebase.json:6) → `"public": "transbordo-app/dist"`

And it includes an SPA rewrite so all routes are handled by the frontend router:

- [`firebase.json`](firebase.json:12) → rewrite `"**"` → `/index.html`

---

## 3) Main User Flows & UI Behavior

### 3.1 Authentication flow (login/signup)

1. User opens the app.
2. The app listens for auth state changes via Firebase:
   - [`onAuthStateChanged()`](transbordo-app/src/App.tsx:161)
3. On first login/sign-up, it ensures a Firestore user profile doc exists:
   - [`ensureUserProfile()`](transbordo-app/src/App.tsx:131)
   - Default role for new users is `OPERADOR`.
4. Routes:
   - `/` redirects to `/login` or `/app` in [`App()`](transbordo-app/src/App.tsx:156)
   - `/login` shows [`LoginPage()`](transbordo-app/src/App.tsx:214)
   - `/app` shows [`FieldPage()`](transbordo-app/src/App.tsx:344)

### 3.2 Event entry flow (“Novo lançamento”)

The main screen is rendered by [`FieldPage()`](transbordo-app/src/App.tsx:344). A user:

1. Selects **Pump** (`Bomba 1` or `Bomba 2`).
2. Inputs:
   - Shift date (`shiftDate`)
   - Shift (`MANHA` / `NOITE`)
   - Start and end time (`HH:MM`)
   - Category
3. Category-specific requirements:
   - `Produtivo` requires: **Client**, **Truck plate**, **Container**
   - Some categories require **Observações** (notes)
4. Clicks **Salvar** to persist the record.

Validation is computed in a memoized block:

- [`validation`](transbordo-app/src/App.tsx:414)

Persistence is handled in:

- [`save()`](transbordo-app/src/App.tsx:597)

Important: Firestore rejects `undefined`. Optional fields are omitted using conditional spreads in [`save()`](transbordo-app/src/App.tsx:597).

### 3.3 Admin: Client management

Admins see a “Clientes (Admin)” section inside [`FieldPage()`](transbordo-app/src/App.tsx:935). It supports:

- Loading clients: [`loadClients()`](transbordo-app/src/App.tsx:487)
- Creating/updating clients: [`upsertClient()`](transbordo-app/src/App.tsx:511)
- Active clients are used for the `Produtivo` dropdown via:
  - [`activeClients`](transbordo-app/src/App.tsx:374)

### 3.4 History viewing & CSV export

History loads events from Firestore in:

- [`loadEvents()`](transbordo-app/src/App.tsx:534)

Filters apply client-side in:

- [`filteredEvents`](transbordo-app/src/App.tsx:473)

CSV export:

- [`exportCsv()`](transbordo-app/src/App.tsx:693)
- Escaping: [`csvEscape()`](transbordo-app/src/App.tsx:111)
- Download: [`downloadCsv()`](transbordo-app/src/App.tsx:119)

---

## 4) Application Architecture & Data Flow

### 4.1 Runtime architecture diagram

```mermaid
flowchart TD
  U[User (OPERADOR / SUPERVISOR / ADMIN)] -->|Browser| UI[React SPA]
  UI -->|Email/Password| AUTH[Firebase Auth]
  UI -->|Read/Write| FS[Cloud Firestore]
  UI -->|Static build assets| HOST[Firebase Hosting]

  FS --> USERS[(users/{uid})]
  FS --> EVENTS[(events/{eventId})]
  FS --> CLIENTS[(clients/{clientId})]
```

### 4.2 State management approach

The app uses **React local component state** (no Redux). Key state in [`FieldPage()`](transbordo-app/src/App.tsx:344):

- `selectedPump`: pump used for new event entries
- `draft`: form state for new entries
- `events`: loaded history
- `clients`: client list for dropdown
- `filterFrom`, `filterTo`, `filterPump`, `filterShift`, `filterCategory`: history filters

The UI reacts to changes because:

- Derived state uses memoization:
  - validation: [`validation`](transbordo-app/src/App.tsx:414)
  - filtered history: [`filteredEvents`](transbordo-app/src/App.tsx:473)
- Mutations update both Firestore and local state:
  - events write and optimistic append: [`save()`](transbordo-app/src/App.tsx:597)
  - clients upsert + reload: [`upsertClient()`](transbordo-app/src/App.tsx:511)

### 4.3 Firestore query strategy

History filtering is intentionally client-side to reduce Firestore index requirements.

Operator query detail:

- Operators query only their own events with `where(createdBy == uid)` in [`loadEvents()`](transbordo-app/src/App.tsx:534).
- The operator query intentionally avoids `orderBy(...)` to avoid composite index requirements, and sorts locally:
  - `items.sort(...)` in [`loadEvents()`](transbordo-app/src/App.tsx:575)

---

## 5) Data Model (Firestore)

### 5.1 Collections

- `users/{uid}`: profile and role
- `events/{eventId}`: operation records
- `clients/{clientId}`: dropdown options for “Produtivo” → “Cliente”

### 5.2 Events (`events/{eventId}`)

TypeScript models:

- `OperationEvent` in [`transbordo-app/src/App.tsx`](transbordo-app/src/App.tsx:52)
- `StoredEvent` in [`transbordo-app/src/App.tsx`](transbordo-app/src/App.tsx:69)

Core fields:

- `pump: 1 | 2`
- `shiftDate: YYYY-MM-DD` (start date of the shift)
- `shift: MANHA | NOITE`
- `category`
- `startAt`, `endAt` (timestamps)
- Optional: `clientId`, `clientName`, `truckPlate`, `containerId`, `notes`
- Audit: `createdBy`, `createdByEmail`, `createdAt`, `updatedAt`

### 5.3 Clients (`clients/{clientId}`)

TypeScript model:

- `Client` in [`transbordo-app/src/App.tsx`](transbordo-app/src/App.tsx:46)

Firestore fields used:

- `name: string`
- `active: boolean`
- `createdAt`, `updatedAt`, `createdBy`, `updatedBy`

---

## 6) Security Model (Firestore Rules)

Rules are in [`firestore.rules`](firestore.rules:1).

### 6.1 Role model

Roles are stored in Firestore user docs, not custom claims:

- Role read helper: [`myRole()`](firestore.rules:14)
- Admin gate: [`isAdmin()`](firestore.rules:18)
- Supervisor or Admin gate: [`isSupervisorOrAdmin()`](firestore.rules:22)

### 6.2 Access policies

**Users**: [`match /users/{uid}`](firestore.rules:30)

- Create: user can create their own doc with role `OPERADOR` only.
- Read: user can read own doc; admin can read any.
- Update: admin can update any; user can update own doc but cannot change role.
- Delete: disabled.

**Clients**: [`match /clients/{clientId}`](firestore.rules:56)

- Read: any signed-in user (for dropdown).
- Create/update: admin only.
- Delete: disabled (use `active=false`).

**Events**: [`match /events/{eventId}`](firestore.rules:67)

- Create: signed-in user; `createdBy` must match `request.auth.uid`.
- Read/update:
  - supervisor/admin can access all
  - operator can access only their own.
- Delete: disabled.

---

## 7) Guided Walkthrough: Primary Codepaths

### 7.1 Bootstrapping

React mounts the app and router in:

- [`transbordo-app/src/main.tsx`](transbordo-app/src/main.tsx:1)

### 7.2 Routing & auth gating

Routes are defined in:

- [`App()`](transbordo-app/src/App.tsx:156)

Auth readiness gating:

- waits for Firebase auth state in [`onAuthStateChanged()`](transbordo-app/src/App.tsx:161)

### 7.3 User provisioning

When a user signs up or logs in the first time, the app creates a profile doc with default role:

- [`ensureUserProfile()`](transbordo-app/src/App.tsx:131)

### 7.4 Shift/time rules

Time parsing:

- [`parseHHMM()`](transbordo-app/src/App.tsx:311)

Shift window rules:

- [`isTimeAllowedInShift()`](transbordo-app/src/App.tsx:320)

Date calculation for `NOITE` shift where `00:00–00:48` belongs to the shift date but is on the next calendar day:

- [`toShiftDateTime()`](transbordo-app/src/App.tsx:332)

### 7.5 Validation → save

Validation:

- [`validation`](transbordo-app/src/App.tsx:414)

Save:

- [`save()`](transbordo-app/src/App.tsx:597)

Key behavior: payload omits optional values instead of using `undefined`:

- conditional spreads in [`save()`](transbordo-app/src/App.tsx:611)

### 7.6 Clients and dropdown population

Load clients:

- [`loadClients()`](transbordo-app/src/App.tsx:487)

Derive active list:

- [`activeClients`](transbordo-app/src/App.tsx:374)

Admin updates:

- [`upsertClient()`](transbordo-app/src/App.tsx:511)

### 7.7 History and export

Load events:

- [`loadEvents()`](transbordo-app/src/App.tsx:534)

Filter:

- [`filteredEvents`](transbordo-app/src/App.tsx:473)

Export:

- [`exportCsv()`](transbordo-app/src/App.tsx:693)

---

## 8) Styling Organization

Styling is primarily organized as **layout helper classes** in [`transbordo-app/src/App.css`](transbordo-app/src/App.css:44). The approach is:

- Keep structural layout in CSS classes (grids, wrappers).
- Keep per-element tweaks in TSX inline styles only where necessary.

Key classes:

- Page structure: `.tp-page`, `.tp-header`, `.tp-section` in [`transbordo-app/src/App.css`](transbordo-app/src/App.css:46)
- Grid layouts: `.tp-grid-2`, `.tp-grid-5`, `.tp-category-grid` in [`transbordo-app/src/App.css`](transbordo-app/src/App.css:95)
- Admin UI rows: `.tp-actions-row`, `.tp-client-row` in [`transbordo-app/src/App.css`](transbordo-app/src/App.css:118)

Responsive behavior:

- 900px breakpoint reduces `.tp-grid-5` to 2 columns in [`transbordo-app/src/App.css`](transbordo-app/src/App.css:164)
- 600px breakpoint collapses grids to 1 column and stacks action rows vertically in [`transbordo-app/src/App.css`](transbordo-app/src/App.css:170)

---

## 9) Pump Selector (“Bomba 1 / 2”) — Detailed Implementation

### 9.1 UX goals

- Larger tap targets for mobile: minimum **44×44 px**
- Clear selected state: **blue background + white text**
- Good keyboard and assistive tech behavior: `aria-pressed`

### 9.2 TSX implementation

In [`FieldPage()`](transbordo-app/src/App.tsx:344):

- State:
  - `selectedPump` is maintained via [`useState`](transbordo-app/src/App.tsx:347)
- Render:
  - Buttons in the pump selector area use:
    - base class: `tp-pump-btn`
    - selected modifier: `tp-pump-btn--active`
    - `aria-pressed={selectedPump === X}`
  - See the pump button block in [`transbordo-app/src/App.tsx`](transbordo-app/src/App.tsx:744)

### 9.3 CSS implementation

CSS classes are defined in:

- `.tp-pump-btn` in [`transbordo-app/src/App.css`](transbordo-app/src/App.css:132)
- `.tp-pump-btn--active` in [`transbordo-app/src/App.css`](transbordo-app/src/App.css:158)

Important attributes:

- `min-height: 44px` and `min-width: 44px` for touch accessibility
- Active state uses blue colors (`#2563eb` / `#1d4ed8`) with white text
- Focus styling uses `:focus-visible` for a blue focus ring

Accessibility note:

- `aria-pressed` indicates a toggle/pressed state, which is appropriate for a “selected pump” control and helps screen readers.

---

## 10) Configuration & Dependencies

### 10.1 Dependencies

Declared in [`transbordo-app/package.json`](transbordo-app/package.json:1):

- Runtime:
  - `firebase`
  - `react`, `react-dom`
  - `react-router-dom`
  - `zod` (available; most validations are currently inline logic in TSX)
- Build/dev:
  - `vite`, `typescript`, `eslint`, `@vitejs/plugin-react`

### 10.2 Firebase config via Vite env vars

Firebase is initialized in [`transbordo-app/src/firebase.ts`](transbordo-app/src/firebase.ts:1) and reads `VITE_FIREBASE_*` variables.

Required keys are checked and a warning is printed if missing:

- missing key warning in [`transbordo-app/src/firebase.ts`](transbordo-app/src/firebase.ts:25)

Expected env vars are documented in:

- comment block in [`transbordo-app/src/firebase.ts`](transbordo-app/src/firebase.ts:5)

---

## 11) Local Development & Testing

### 11.1 Install and run

From repo root:

```bash
cd transbordo-app
npm ci
npm run dev
```

Scripts are defined in [`transbordo-app/package.json`](transbordo-app/package.json:6).

### 11.2 Suggested verification checklist

- Auth:
  - Sign up and confirm profile is created with role `OPERADOR` via [`ensureUserProfile()`](transbordo-app/src/App.tsx:131).
- Clients:
  - As admin, create a client and verify it appears in the `Produtivo` dropdown (see [`loadClients()`](transbordo-app/src/App.tsx:487)).
- Validation:
  - Verify `Produtivo` requires client/plate/container (see [`validation`](transbordo-app/src/App.tsx:414)).
  - Verify categories requiring notes enforce `notes` (see `categoriesRequiringNotes` in [`transbordo-app/src/App.tsx`](transbordo-app/src/App.tsx:362)).
- Save:
  - Create an event and confirm it appears in history immediately (optimistic add in [`save()`](transbordo-app/src/App.tsx:660)).
- Export:
  - Export CSV via [`exportCsv()`](transbordo-app/src/App.tsx:693) and open in Excel.

---

## 12) Build & Deployment

### 12.1 Build (exact commands)

From repo root:

```bash
cd transbordo-app
npm ci
npm run build
```

Build output is written to `transbordo-app/dist`, served by Firebase Hosting per [`firebase.json`](firebase.json:6).

### 12.2 Deploy (exact commands)

From repo root:

```bash
firebase deploy --only hosting --project transbordo-6fc6f
```

Hosting configuration is in [`firebase.json`](firebase.json:1).

### 12.3 Typical Git workflow

```bash
git add <files>
git commit -m "<message>"
git push
```

---

## 13) Troubleshooting

### 13.1 Firestore error: “Unsupported field value: undefined”

Cause: Firestore rejects `undefined`.  
Mitigation: omit optional keys using conditional spreads in [`save()`](transbordo-app/src/App.tsx:611).

### 13.2 Firestore error: “The query requires an index”

Cause: some `where(...)` + `orderBy(...)` combinations require composite indexes.  
Mitigation used for operators: avoid `orderBy` and sort in memory in [`loadEvents()`](transbordo-app/src/App.tsx:534).

### 13.3 Firestore error: “Missing or insufficient permissions”

Cause: Firestore rules disallow read/write based on role or ownership.  
Review:

- Users: [`match /users/{uid}`](firestore.rules:30)
- Clients: [`match /clients/{clientId}`](firestore.rules:56)
- Events: [`match /events/{eventId}`](firestore.rules:67)

### 13.4 Console warning about missing Firebase config keys

Cause: missing Vite env variables.  
Where to check:

- env validation in [`transbordo-app/src/firebase.ts`](transbordo-app/src/firebase.ts:25)

---

## 14) Appendix: Key Files

- Application:
  - [`transbordo-app/src/App.tsx`](transbordo-app/src/App.tsx:1)
  - [`transbordo-app/src/main.tsx`](transbordo-app/src/main.tsx:1)
  - [`transbordo-app/src/firebase.ts`](transbordo-app/src/firebase.ts:1)
- Styling:
  - [`transbordo-app/src/App.css`](transbordo-app/src/App.css:1)
- Config:
  - [`transbordo-app/package.json`](transbordo-app/package.json:1)
  - [`firebase.json`](firebase.json:1)
  - [`firestore.rules`](firestore.rules:1)