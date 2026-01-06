# transbordo-app — End-to-End Technical Documentation

## 1) Purpose & Problem Statement

**transbordo-app** is a web application for logging and auditing “Transbordo de Glicerina” operations in a plant/yard environment. The operation requires recording **time intervals**, **pump used (Bomba 1/2)**, **shift** rules, and **operational context** (productive vs. waiting/maintenance reasons). The app replaces ad-hoc notes/spreadsheets with a consistent, validated dataset that can be filtered and exported to CSV.

### Target users
- **Operators**: create records for their own work and review their own history.
- **Supervisors**: review and export all records.
- **Admins**: manage users’ roles and maintain the **Client** list used by the “Produtivo” workflow.

Roles are represented by the `Role` type in [`transbordo-app/src/App.tsx`](transbordo-app/src/App.tsx:26).

---

## 2) System Overview

This is a **single-page application (SPA)** built with **React + TypeScript + Vite**, hosted on **Firebase Hosting**, with:
- **Firebase Authentication** (email/password)
- **Cloud Firestore** for data storage (events, users, clients)
- **Firestore Security Rules** controlling access

### High-level components
- UI: React routes in [`App()`](transbordo-app/src/App.tsx:156) render:
  - login page
  - main “field” page (event entry + history)
- Data access: Firestore reads/writes in [`FieldPage()`](transbordo-app/src/App.tsx:344)
- Auth & role bootstrap: [`ensureUserProfile()`](transbordo-app/src/App.tsx:131)
- Deployment: Firebase Hosting configuration in [`firebase.json`](firebase.json:1) and rules in [`firestore.rules`](firestore.rules:1)

### What Firebase Hosting serves
Firebase Hosting serves the static build output from:
- [`firebase.json`](firebase.json:6) → `"public": "transbordo-app/dist"`

It also contains an SPA rewrite so all routes go to `index.html`:
- [`firebase.json`](firebase.json:12)

---

## 3) Main User Flows & UI Behavior

### 3.1 Authentication flow
1. User opens the app.
2. App listens for authentication state via Firebase:
   - [`onAuthStateChanged()`](transbordo-app/src/App.tsx:161)
3. On first login/sign-up, the app ensures there is a Firestore user profile doc:
   - [`ensureUserProfile()`](transbordo-app/src/App.tsx:131)
   - Default role is `OPERADOR` when the user doc doesn’t exist.
4. Route handling:
   - Root redirects to `/login` or `/app` depending on auth state in [`App()`](transbordo-app/src/App.tsx:156)

### 3.2 Event entry flow (“Novo lançamento”)
On the main screen rendered by [`FieldPage()`](transbordo-app/src/App.tsx:344), the operator:
1. Selects **Pump** (Bomba 1/2).
2. Inputs:
   - Shift date
   - Shift (MANHA/NOITE)
   - Start/End time (HH:MM)
   - Category
3. If category is `Produtivo`, additional required fields exist:
   - Client (from dropdown)
   - Truck plate
   - Container
4. If category requires notes, observations are mandatory.

Validation logic is computed in a memoized block:
- [`useMemo()`](transbordo-app/src/App.tsx:414)

Save action:
- [`save()`](transbordo-app/src/App.tsx:597)
- The Firestore payload is built using conditional spreads so optional fields are **omitted**, not set to `undefined` (Firestore rejects `undefined`).

### 3.3 Clients management flow (Admin only)
Admins see a “Clientes (Admin)” card inside [`FieldPage()`](transbordo-app/src/App.tsx:344):
- Load clients: [`loadClients()`](transbordo-app/src/App.tsx:487)
- Create/update clients: [`upsertClient()`](transbordo-app/src/App.tsx:511)
- The dropdown for “Produtivo” uses only active clients:
  - derived as `activeClients` in [`useMemo()`](transbordo-app/src/App.tsx:374)

### 3.4 History and Export flow
History:
- Events are loaded from Firestore in [`loadEvents()`](transbordo-app/src/App.tsx:534)
- Client-side filters apply in [`filteredEvents`](transbordo-app/src/App.tsx:473)
- Export:
  - [`exportCsv()`](transbordo-app/src/App.tsx:693)
  - Helpers: [`csvEscape()`](transbordo-app/src/App.tsx:111), [`downloadCsv()`](transbordo-app/src/App.tsx:119)

---

## 4) Architecture & Data Flow

### 4.1 Runtime architecture diagram

```mermaid
flowchart TD
  U[User (Operator/Supervisor/Admin)] -->|Browser| UI[React SPA]
  UI -->|Email/Password| AUTH[Firebase Auth]
  UI -->|Read/Write| FS[Cloud Firestore]
  UI -->|Static files| HOST[Firebase Hosting]

  FS --> USERS[(users/{uid})]
  FS --> EVENTS[(events/{eventId})]
  FS --> CLIENTS[(clients/{clientId})]
```

### 4.2 State management approach
This project uses **React local state** (no Redux). Key state variables live in [`FieldPage()`](transbordo-app/src/App.tsx:344):
- `selectedPump`: current pump used for new event records
- `draft`: current form values for the event being entered
- `events`: loaded history records
- `clients`: client list for dropdown
- `filter*`: client-side history filters

The UI “reacts” to changes because:
- Derived values are computed with memoization:
  - validation is computed in [`useMemo()`](transbordo-app/src/App.tsx:414)
  - filtered event list is computed in [`useMemo()`](transbordo-app/src/App.tsx:473)
- Save or client upsert triggers Firestore writes and then local updates:
  - optimistic append for new events happens in [`save()`](transbordo-app/src/App.tsx:597)

### 4.3 Firestore query strategy
To avoid requiring many composite indexes, filtering is mostly done client-side:
- events query loads up to 2000 records and then filters in memory.

A key detail: Operators query only their events using a `where` clause:
- [`loadEvents()`](transbordo-app/src/App.tsx:534)

The Operator query intentionally **does not** use `orderBy` so it doesn’t require a composite index; the list is sorted locally:
- `items.sort(...)` in [`loadEvents()`](transbordo-app/src/App.tsx:534)

---

## 5) Data Model (Firestore)

### 5.1 Collections overview
- `users/{uid}`: user profile + role
- `events/{eventId}`: operation records
- `clients/{clientId}`: dropdown options for the `Produtivo` client selection

### 5.2 Event document shape (conceptual)
The runtime TypeScript model is captured by:
- `OperationEvent` in [`transbordo-app/src/App.tsx`](transbordo-app/src/App.tsx:52)
- `StoredEvent` in [`transbordo-app/src/App.tsx`](transbordo-app/src/App.tsx:69)

Important fields include:
- `pump` (1 or 2)
- `shiftDate` (YYYY-MM-DD start date of the shift)
- `shift` (`MANHA`/`NOITE`)
- `category`
- `startAt`, `endAt` (timestamps)
- Optional:
  - `clientId`, `clientName`, `truckPlate`, `containerId`, `notes`
- Audit:
  - `createdBy`, `createdByEmail`, `createdAt`, `updatedAt`

### 5.3 Clients collection shape
Client list items are represented by:
- `Client` in [`transbordo-app/src/App.tsx`](transbordo-app/src/App.tsx:46)

Firestore fields used:
- `name: string`
- `active: boolean`
- `createdAt`, `updatedAt`, `createdBy`, `updatedBy`

---

## 6) Security Model (Firestore Rules)

Rules live in [`firestore.rules`](firestore.rules:1).

### 6.1 Authentication helpers
- Signed-in check: [`isSignedIn()`](firestore.rules:4)
- Role lookup from `users/{uid}`: [`myUserDoc()`](firestore.rules:10), [`myRole()`](firestore.rules:14)
- Role gates: [`isAdmin()`](firestore.rules:18), [`isSupervisorOrAdmin()`](firestore.rules:22)

### 6.2 Access policies
- Users:
  - Create own user doc with role `OPERADOR` only:
    - [`match /users/{uid}`](firestore.rules:30)
  - Admin can read/update any user; non-admin can read/update own doc but cannot change role.
- Clients:
  - Read: any signed-in user
  - Create/update: admin only
  - Delete: disabled
  - [`match /clients/{clientId}`](firestore.rules:56)
- Events:
  - Create: signed-in user; `createdBy` must match `request.auth.uid`
  - Read: supervisor/admin can read all; operator can read only their own
  - Update: same as read
  - Delete: disabled
  - [`match /events/{eventId}`](firestore.rules:67)

---

## 7) Guided Walkthrough: Core Codepaths

### 7.1 Entry point and routing
- App bootstrap mounts React + router:
  - [`main.tsx`](transbordo-app/src/main.tsx:1)
- Router definition:
  - [`App()`](transbordo-app/src/App.tsx:156)

### 7.2 Auth handshake and role provisioning
Auth state changes:
- [`onAuthStateChanged()`](transbordo-app/src/App.tsx:161)

Role provisioning:
- [`ensureUserProfile()`](transbordo-app/src/App.tsx:131)
  - If user doc missing, creates it with role `OPERADOR`.

### 7.3 Shift time rules
Time parsing:
- [`parseHHMM()`](transbordo-app/src/App.tsx:311)

Allowed window per shift:
- [`isTimeAllowedInShift()`](transbordo-app/src/App.tsx:320)

Shift-date handling for “NOITE” (00:00–00:48 is next calendar day but belongs to the shift start date):
- [`toShiftDateTime()`](transbordo-app/src/App.tsx:332)

### 7.4 Validation and save pipeline
Validation:
- `validation` computed in [`useMemo()`](transbordo-app/src/App.tsx:414)
  - Enforces category-specific requirements:
    - `Produtivo`: requires client, plate, container
    - Certain categories require notes
  - Converts `shiftDate + HH:MM` into real `Date` objects (start/end)

Save:
- [`save()`](transbordo-app/src/App.tsx:597)
  - Builds the Firestore payload and **omits optional fields** if empty.
  - Writes to Firestore with [`setDoc()`](transbordo-app/src/App.tsx:658)
  - Adds a local optimistic record to `events`.

### 7.5 Loading clients and events
Clients:
- [`loadClients()`](transbordo-app/src/App.tsx:487)
- Admin write path:
  - [`upsertClient()`](transbordo-app/src/App.tsx:511)

Events:
- [`loadEvents()`](transbordo-app/src/App.tsx:534)
  - Operator query uses `where(createdBy == uid)` without `orderBy` and sorts locally.

### 7.6 Export pipeline
CSV build:
- [`exportCsv()`](transbordo-app/src/App.tsx:693)
- Escaping:
- [`csvEscape()`](transbordo-app/src/App.tsx:111)
- File download:
- [`downloadCsv()`](transbordo-app/src/App.tsx:119)

---

## 8) Styling Organization: App.css

Styles are largely organized as reusable layout utility classes in [`transbordo-app/src/App.css`](transbordo-app/src/App.css:44), including:
- `.tp-page`, `.tp-header`, `.tp-section`
- `.tp-grid-2`, `.tp-grid-5` (responsive breakpoints)
- `.tp-category-grid`, `.tp-actions-row`, `.tp-client-row`

Mobile responsiveness is handled by media queries:
- 900px breakpoint for the 5-column filter grid in [`transbordo-app/src/App.css`](transbordo-app/src/App.css:164)
- 600px breakpoint to collapse grids to 1 column and make action rows stack vertically in [`transbordo-app/src/App.css`](transbordo-app/src/App.css:170)

---

## 9) Pump Selector (“Bomba 1 / 2”) Implementation Details

### 9.1 UX goals
- **Bigger tap targets** (mobile friendly): minimum 44×44px.
- **Clear selected state**: blue filled background + white text.
- **Accessible toggle behavior**: `aria-pressed`.

### 9.2 Implementation in TSX
In the field page header area, the pump selector uses:
- local state `selectedPump` in [`FieldPage()`](transbordo-app/src/App.tsx:344)
- buttons with conditional classes and `aria-pressed` in the pump selector section of [`FieldPage()`](transbordo-app/src/App.tsx:744)

### 9.3 Styling in CSS
Button base style and active modifier are in [`transbordo-app/src/App.css`](transbordo-app/src/App.css:132), with:
- `min-height: 44px`
- `min-width: 44px`
- padding and typography
- active state `.tp-pump-btn--active` (blue background, white text)

Accessibility note:
- `aria-pressed` communicates toggle state to assistive technologies and aligns with “pressed button” semantics.

---

## 10) Configuration, Environment Assumptions, and Dependencies

### 10.1 Dependencies
Declared in [`transbordo-app/package.json`](transbordo-app/package.json:1):
- `react`, `react-dom`
- `react-router-dom`
- `firebase`
- `zod` (installed; used for validation potential, but most validation currently is inline TypeScript logic)

### 10.2 Firebase configuration via Vite env
Firebase initialization is in [`transbordo-app/src/firebase.ts`](transbordo-app/src/firebase.ts:1). The app expects Firebase config values to be provided via Vite env variables (typically in `.env.local`). When values are missing, a console warning is emitted in [`transbordo-app/src/firebase.ts`](transbordo-app/src/firebase.ts:25).

### 10.3 Vite config
Vite configuration is minimal in [`vite.config.ts`](transbordo-app/vite.config.ts:1).

---

## 11) Local Development

### 11.1 Install and run
From repo root:

```bash
cd transbordo-app
npm ci
npm run dev
```

Scripts are defined in [`transbordo-app/package.json`](transbordo-app/package.json:6).

### 11.2 Common verification steps
- Login/sign up and ensure the profile is created with role `OPERADOR`:
  - creation path in [`ensureUserProfile()`](transbordo-app/src/App.tsx:131)
- Create a `Produtivo` record:
  - confirm client dropdown populates from Firestore in [`loadClients()`](transbordo-app/src/App.tsx:487)
  - confirm required fields enforced by validation in [`useMemo()`](transbordo-app/src/App.tsx:414)
- Create a record for a category that requires notes and confirm empty notes are rejected:
  - notes requirement enforced by `categoriesRequiringNotes` in [`useMemo()`](transbordo-app/src/App.tsx:362)
- Verify History loads (Operator sees only own):
  - Operator query logic in [`loadEvents()`](transbordo-app/src/App.tsx:534)
- Export CSV and open in Excel:
  - exporter in [`exportCsv()`](transbordo-app/src/App.tsx:693)

---

## 12) Build and Deployment

### 12.1 Build commands (exact)
From repo root:

```bash
cd transbordo-app
npm ci
npm run build
```

The build produces static assets under `transbordo-app/dist` (as configured in [`firebase.json`](firebase.json:6)).

### 12.2 Deploy to Firebase Hosting (exact)
From repo root:

```bash
firebase deploy --only hosting --project transbordo-6fc6f
```

Hosting config:
- [`firebase.json`](firebase.json:1)

### 12.3 Typical Git workflow used (exact)
From repo root:

```bash
git add <files>
git commit -m "<message>"
git push
```

In this project’s recent workflow, a feature branch (`fix/mobile-layout`) was pushed and then deployed manually.

---

## 13) Troubleshooting

### 13.1 “Unsupported field value: undefined” when saving to Firestore
Cause: Firestore rejects `undefined`.  
Fix: omit optional fields rather than sending them. The current implementation builds the payload using conditional spreads in [`save()`](transbordo-app/src/App.tsx:597).

### 13.2 “The query requires an index” when loading history
Cause: certain combinations of `where(...)` + `orderBy(...)` require composite indexes.  
Mitigation used here: Operator query avoids `orderBy` and sorts in memory in [`loadEvents()`](transbordo-app/src/App.tsx:534).

### 13.3 “Missing or insufficient permissions”
Cause: Firestore rules blocking reads/writes due to role or ownership checks.  
Review:
- event access in [`match /events/{eventId}`](firestore.rules:67)
- client access in [`match /clients/{clientId}`](firestore.rules:56)
- user access in [`match /users/{uid}`](firestore.rules:30)

### 13.4 Firebase config warnings in console
Cause: missing env values for Firebase config.  
Check the warning logic in [`transbordo-app/src/firebase.ts`](transbordo-app/src/firebase.ts:25) and ensure required values are present.

---

## 14) Appendix: Key Files Index

- Application code:
  - [`transbordo-app/src/App.tsx`](transbordo-app/src/App.tsx:1)
  - [`transbordo-app/src/main.tsx`](transbordo-app/src/main.tsx:1)
  - [`transbordo-app/src/firebase.ts`](transbordo-app/src/firebase.ts:1)
- Styling:
  - [`transbordo-app/src/App.css`](transbordo-app/src/App.css:1)
- Configuration:
  - [`transbordo-app/package.json`](transbordo-app/package.json:1)
  - [`firebase.json`](firebase.json:1)
  - [`firestore.rules`](firestore.rules:1)
