import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth'
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'
import { auth, db } from './firebase'
import './App.css'

type ThemeMode = 'system' | 'light' | 'dark'

const THEME_STORAGE_KEY = 'tp.theme'

function readThemeMode(): ThemeMode {
  const raw = localStorage.getItem(THEME_STORAGE_KEY)
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  return 'system'
}

function persistThemeMode(mode: ThemeMode) {
  localStorage.setItem(THEME_STORAGE_KEY, mode)
}

function applyThemeMode(mode: ThemeMode) {
  const root = document.documentElement
  // When absent: CSS uses prefers-color-scheme
  if (mode === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', mode)
}

function ThemeSelect(props: { mode: ThemeMode; onChange: (mode: ThemeMode) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
      Tema
      <select
        value={props.mode}
        onChange={(e) => props.onChange(e.target.value as ThemeMode)}
        style={{ padding: 8 }}
        aria-label="Tema"
        title="Tema: Sistema/Claro/Escuro"
      >
        <option value="system">Sistema</option>
        <option value="light">Claro</option>
        <option value="dark">Escuro</option>
      </select>
    </label>
  )
}

function AppFooter() {
  const year = new Date().getFullYear()
  return (
    <footer className="tp-footer">
      <div className="tp-footer__row">
        <span>
          <b>Criador:</b> Matheus Raimundo
        </span>
        <span className="tp-footer__sep">•</span>
        <span>© {year} Matheus Raimundo. Todos os direitos reservados.</span>
        <span className="tp-footer__sep">•</span>
        <a href="https://wa.me/5513997112838" target="_blank" rel="noreferrer">
          Suporte: WhatsApp +55 13 99711-2838
        </a>
      </div>
    </footer>
  )
}

type Role = 'OPERADOR' | 'SUPERVISOR' | 'ADMIN'

type User = {
  uid: string
  email: string
  role: Role
  approved: boolean
}

type Pump = 1 | 2

type ActivityCategory =
  | 'Produtivo'
  | 'Aguardando laboratório'
  | 'Sem caminhão'
  | 'Sem container'
  | 'Manutenção'
  | 'Outros'

type Shift = 'MANHA' | 'NOITE'

type Client = {
  id: string
  name: string
  active: boolean
}

type OperationEvent = {
  id: string
  pump: Pump
  shiftDate: string // YYYY-MM-DD (dia de início do turno)
  shift: Shift
  category: ActivityCategory
  startAt: Date
  endAt: Date
  // Produtivo
  clientId?: string
  clientName?: string
  truckPlate?: string
  containerId?: string
  // Observações (obrigatória em: Outros, Sem caminhão, Manutenção, Aguardando laboratório, Sem container)
  notes?: string
}

type StoredEvent = OperationEvent & {
  createdBy: string
  createdByEmail?: string
  createdAt?: Date
  updatedAt?: Date
}

function isMercosulOrOldPlate(value: string): boolean {
  const v = value.trim().toUpperCase()
  // Old format: ABC1234
  const oldFormat = /^[A-Z]{3}\d{4}$/
  // Mercosul: ABC1D23 (the 5th char can be a letter or digit depending on the state, we'll accept alnum)
  const mercosulFormat = /^[A-Z]{3}\d[A-Z0-9]\d{2}$/
  return oldFormat.test(v) || mercosulFormat.test(v)
}

function isContainerId(value: string): boolean {
  const v = value.trim().toUpperCase()
  // Common operational format: ABCD 123456-7 (space and hyphen optional)
  return /^[A-Z]{4}\s?\d{6}-?\d$/.test(v)
}

function formatDurationMinutes(startAt: Date, endAt: Date): string {
  const ms = Math.max(0, endAt.getTime() - startAt.getTime())
  const totalMinutes = Math.floor(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes} min`
  return `${hours}h ${minutes}m`
}

function nowId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * Returns YYYY-MM-DD using the user's local timezone (not UTC).
 * Avoids the "day shift" bug when using `toISOString().slice(0, 10)` in UTC- offsets.
 */
function localISODate(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function toDateSafe(value: unknown): Date | undefined {
  if (!value) return undefined
  if (value instanceof Date) return value
  if (value instanceof Timestamp) return value.toDate()
  return undefined
}

function csvEscape(value: unknown): string {
  const s = (value ?? '').toString()
  // Excel-friendly: quote if contains delimiter/newline/quotes
  const needsQuote = /[;"\n\r]/.test(s)
  const escaped = s.replace(/"/g, '""')
  return needsQuote ? `"${escaped}"` : escaped
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

async function ensureUserProfile(firebaseUser: FirebaseUser): Promise<User> {
  const email = firebaseUser.email ?? ''
  const ref = doc(db, 'users', firebaseUser.uid)
  const snap = await getDoc(ref)

  if (!snap.exists()) {
    const defaultRole: Role = 'OPERADOR'
    await setDoc(
      ref,
      {
        email,
        role: defaultRole,
        approved: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    )
    return { uid: firebaseUser.uid, email, role: defaultRole, approved: false }
  }

  const data = snap.data() as Partial<{ email: string; role: Role; approved: boolean }>
  const role: Role = data.role ?? 'OPERADOR'
  const approved = data.approved === true
  return { uid: firebaseUser.uid, email: data.email ?? email, role, approved }
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeMode())

  useEffect(() => {
    applyThemeMode(themeMode)
    persistThemeMode(themeMode)
  }, [themeMode])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (!firebaseUser) {
          setUser(null)
          return
        }
        const profile = await ensureUserProfile(firebaseUser)
        setUser(profile)
      } finally {
        setAuthReady(true)
      }
    })

    return () => unsub()
  }, [])

  if (!authReady) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ fontWeight: 700 }}>Transbordo</div>
        <div style={{ opacity: 0.8 }}>Carregando autenticação…</div>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to={user ? '/app' : '/login'} replace />} />
      <Route
        path="/login"
        element={
          user ? (
            <Navigate to="/app" replace />
          ) : (
            <LoginPage themeMode={themeMode} onThemeModeChange={setThemeMode} />
          )
        }
      />
      <Route
        path="/app"
        element={
          user ? (
            user.approved ? (
              <FieldPage
                user={user}
                onLogout={() => signOut(auth)}
                themeMode={themeMode}
                onThemeModeChange={setThemeMode}
              />
            ) : (
              <PendingApproval
                user={user}
                onLogout={() => signOut(auth)}
                themeMode={themeMode}
                onThemeModeChange={setThemeMode}
              />
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

function PendingApproval(props: {
  user: User
  onLogout: () => void
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
}) {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Aguardando aprovação</h1>
        <ThemeSelect mode={props.themeMode} onChange={props.onThemeModeChange} />
      </div>

      <p style={{ opacity: 0.85 }}>
        Sua conta foi criada, mas ainda não está aprovada para usar o sistema.
      </p>

      <div className="tp-card">
        <div style={{ fontWeight: 700 }}>Usuário</div>
        <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 13 }}>{props.user.email}</div>
        <div style={{ marginTop: 6, opacity: 0.85, fontSize: 13 }}>
          Status: <b style={{ color: 'var(--tp-danger)' }}>NÃO APROVADO</b>
        </div>
      </div>

      <div style={{ marginTop: 12, fontSize: 13, opacity: 0.85 }}>
        <div style={{ fontWeight: 700 }}>Como aprovar (Firebase Console)</div>
        <ol style={{ margin: '8px 0 0 18px' }}>
          <li>Firebase Console → Firestore Database</li>
          <li>Coleção <b>users</b></li>
          <li>Abra o documento do seu usuário</li>
          <li>Defina <b>approved = true</b> (e ajuste <b>role</b> se necessário)</li>
        </ol>
      </div>

      <div style={{ marginTop: 16 }}>
        <button onClick={props.onLogout}>Sair</button>
      </div>

      <AppFooter />
    </div>
  )
}

function NotFound() {
  return (
    <div style={{ padding: 24 }}>
      <h2>Página não encontrada</h2>
      <Link to="/">Voltar</Link>
    </div>
  )
}

function LoginPage(props: { themeMode: ThemeMode; onThemeModeChange: (mode: ThemeMode) => void }) {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogin() {
    setError(null)
    setBusy(true)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
      nav('/app')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleSignup() {
    setError(null)
    setBusy(true)
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password)
      // ensureUserProfile will run on auth state change; this is just to fail fast if Firestore is blocked.
      await ensureUserProfile(cred.user)
      nav('/app')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Transbordo • Login</h1>
        <ThemeSelect mode={props.themeMode} onChange={props.onThemeModeChange} />
      </div>

      <p style={{ opacity: 0.8, marginTop: 8 }}>
        Acesso restrito: entre com Email/Senha (Firebase Auth). Se não tiver conta, crie uma.
      </p>

      <label style={{ display: 'block', marginTop: 12 }}>
        Email
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          inputMode="email"
          style={{ width: '100%', padding: 10, marginTop: 6 }}
        />
      </label>

      <label style={{ display: 'block', marginTop: 12 }}>
        Senha
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          style={{ width: '100%', padding: 10, marginTop: 6 }}
        />
      </label>

      {error ? (
        <div style={{ marginTop: 12, fontSize: 13, whiteSpace: 'pre-wrap' }} className="tp-danger-text">
          {error}
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        <button
          style={{ padding: 12, width: '100%' }}
          onClick={handleLogin}
          disabled={busy || !email.trim() || password.length < 6}
          title={password.length < 6 ? 'Senha precisa ter pelo menos 6 caracteres' : 'Entrar'}
        >
          {busy ? 'Aguarde…' : 'Entrar'}
        </button>

        <button
          style={{ padding: 12, width: '100%' }}
          onClick={handleSignup}
          disabled={busy || !email.trim() || password.length < 6}
          title={password.length < 6 ? 'Senha precisa ter pelo menos 6 caracteres' : 'Criar conta'}
        >
          {busy ? 'Aguarde…' : 'Criar conta'}
        </button>
      </div>

      <p style={{ opacity: 0.7, fontSize: 12, marginTop: 12 }}>
        Observação: por padrão, novos usuários entram como <b>OPERADOR</b> e depois podem ser promovidos por um Admin.
      </p>

      <AppFooter />
    </div>
  )
}

function parseHHMM(value: string): { hours: number; minutes: number; totalMinutes: number } | null {
  const v = value.trim()
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v)
  if (!m) return null
  const hours = Number(m[1])
  const minutes = Number(m[2])
  return { hours, minutes, totalMinutes: hours * 60 + minutes }
}

function isTimeAllowedInShift(shift: Shift, totalMinutes: number): boolean {
  if (shift === 'MANHA') {
    // 06:00–15:00
    return totalMinutes >= 6 * 60 && totalMinutes <= 15 * 60
  }

  // NOITE: 15:00–23:59 and 00:00–00:48
  const inAfternoon = totalMinutes >= 15 * 60 && totalMinutes <= 23 * 60 + 59
  const inAfterMidnight = totalMinutes >= 0 && totalMinutes <= 48
  return inAfternoon || inAfterMidnight
}

function toShiftDateTime(shiftDateISO: string, shift: Shift, totalMinutes: number): Date {
  // shiftDateISO is the start-day of the shift (YYYY-MM-DD).
  // For NOITE, 00:00–00:48 belongs to next calendar day but still the same shift_date.
  const base = new Date(`${shiftDateISO}T00:00:00`)
  const d = new Date(base)
  if (shift === 'NOITE' && totalMinutes >= 0 && totalMinutes <= 48) {
    d.setDate(d.getDate() + 1)
  }
  d.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0)
  return d
}

function FieldPage(props: {
  user: User
  onLogout: () => void
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
}) {
  const todayISO = localISODate()

  const [selectedPump, setSelectedPump] = useState<Pump>(1)

  // Raw events loaded from Firestore (already filtered by permissions via rules).
  const [events, setEvents] = useState<StoredEvent[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [eventsError, setEventsError] = useState<string | null>(null)

  // Clients (for Produtivo dropdown)
  const [clients, setClients] = useState<Client[]>([])
  const [loadingClients, setLoadingClients] = useState(false)
  const [clientsError, setClientsError] = useState<string | null>(null)

  const [newClientName, setNewClientName] = useState('')
  const [savingClient, setSavingClient] = useState(false)

  const categoriesRequiringNotes = useMemo<Set<ActivityCategory>>(
    () =>
      new Set<ActivityCategory>([
        'Outros',
        'Sem caminhão',
        'Manutenção',
        'Aguardando laboratório',
        'Sem container',
      ]),
    [],
  )

  const activeClients = useMemo(() => clients.filter((c) => c.active), [clients])

  // Filters (client-side to avoid requiring many Firestore composite indexes)
  const [filterFrom, setFilterFrom] = useState<string>(todayISO)
  const [filterTo, setFilterTo] = useState<string>(todayISO)
  const [filterPump, setFilterPump] = useState<'ALL' | Pump>('ALL')
  const [filterShift, setFilterShift] = useState<'ALL' | Shift>('ALL')
  const [filterCategory, setFilterCategory] = useState<'ALL' | ActivityCategory>('ALL')

  const [draft, setDraft] = useState<{
    shiftDate: string
    shift: Shift
    category: ActivityCategory
    startHHMM: string
    endHHMM: string
    clientId: string
    truckPlate: string
    containerId: string
    notes: string
  }>({
    shiftDate: todayISO,
    shift: 'MANHA',
    category: 'Produtivo',
    startHHMM: '',
    endHHMM: '',
    clientId: '',
    truckPlate: '',
    containerId: '',
    notes: '',
  })

  const categories: ActivityCategory[] = [
    'Produtivo',
    'Aguardando laboratório',
    'Sem caminhão',
    'Sem container',
    'Manutenção',
    'Outros',
  ]

  const validation = useMemo(() => {
    const errors: string[] = []

    if (!draft.shiftDate) errors.push('Selecione a data do turno.')
    if (!draft.startHHMM) errors.push('Preencha horário de início (HH:MM).')
    if (!draft.endHHMM) errors.push('Preencha horário de fim (HH:MM).')

    const startParsed = draft.startHHMM ? parseHHMM(draft.startHHMM) : null
    const endParsed = draft.endHHMM ? parseHHMM(draft.endHHMM) : null

    if (draft.startHHMM && !startParsed) errors.push('Formato inválido em Início (use HH:MM, 24h).')
    if (draft.endHHMM && !endParsed) errors.push('Formato inválido em Fim (use HH:MM, 24h).')

    if (startParsed && !isTimeAllowedInShift(draft.shift, startParsed.totalMinutes)) {
      errors.push('Horário de início fora do turno selecionado.')
    }
    if (endParsed && !isTimeAllowedInShift(draft.shift, endParsed.totalMinutes)) {
      errors.push('Horário de fim fora do turno selecionado.')
    }

    let startAt: Date | null = null
    let endAt: Date | null = null

    if (startParsed && endParsed && draft.shiftDate) {
      startAt = toShiftDateTime(draft.shiftDate, draft.shift, startParsed.totalMinutes)
      endAt = toShiftDateTime(draft.shiftDate, draft.shift, endParsed.totalMinutes)

      if (endAt.getTime() <= startAt.getTime()) {
        errors.push('Fim precisa ser depois do início.')
      }
    }

    const needsNotes = categoriesRequiringNotes.has(draft.category)

    if (draft.category === 'Produtivo') {
      if (!draft.clientId) {
        errors.push('Produtivo: Cliente obrigatório.')
      } else {
        const c = clients.find((x) => x.id === draft.clientId)
        if (!c) errors.push('Produtivo: Cliente selecionado não existe (atualize a lista).')
        else if (!c.active) errors.push('Produtivo: Cliente selecionado está inativo.')
      }

      if (!draft.truckPlate.trim() || !isMercosulOrOldPlate(draft.truckPlate)) {
        errors.push('Produtivo: Placa obrigatória e deve estar em formato válido.')
      }
      if (!draft.containerId.trim() || !isContainerId(draft.containerId)) {
        errors.push('Produtivo: Container obrigatório e deve estar em formato válido.')
      }
      // Observação é opcional em Produtivo
    }

    if (needsNotes) {
      if (!draft.notes.trim()) errors.push(`${draft.category}: Observações obrigatória.`)
    }

    return { errors, startAt, endAt }
  }, [draft, categoriesRequiringNotes, clients])

  const filteredEvents = useMemo(() => {
    const from = filterFrom ? new Date(`${filterFrom}T00:00:00`) : null
    const to = filterTo ? new Date(`${filterTo}T23:59:59`) : null

    return events.filter((e) => {
      if (from && e.startAt < from) return false
      if (to && e.startAt > to) return false
      if (filterPump !== 'ALL' && e.pump !== filterPump) return false
      if (filterShift !== 'ALL' && e.shift !== filterShift) return false
      if (filterCategory !== 'ALL' && e.category !== filterCategory) return false
      return true
    })
  }, [events, filterFrom, filterTo, filterPump, filterShift, filterCategory])

  async function loadClients() {
    setClientsError(null)
    setLoadingClients(true)
    try {
      const base = collection(db, 'clients')
      const q = query(base, orderBy('name', 'asc'), limit(5000))
      const snap = await getDocs(q)
      const items: Client[] = snap.docs
        .map((d) => {
          const data = d.data() as Record<string, unknown>
          const name = (data.name as string) ?? ''
          const active = (data.active as boolean) ?? true
          if (!name.trim()) return null
          return { id: d.id, name, active }
        })
        .filter(Boolean) as Client[]
      setClients(items)
    } catch (e) {
      setClientsError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingClients(false)
    }
  }

  async function upsertClient(params: { id?: string; name: string; active: boolean }) {
    if (props.user.role !== 'ADMIN') return
    const name = params.name.trim()
    if (!name) return
    const id = params.id ?? nowId()

    const data: Record<string, unknown> = {
      name,
      active: params.active,
      updatedAt: serverTimestamp(),
      updatedBy: props.user.uid,
      ...(params.id
        ? {}
        : {
            createdAt: serverTimestamp(),
            createdBy: props.user.uid,
          }),
    }

    await setDoc(doc(db, 'clients', id), data, { merge: true })
    await loadClients()
  }

  async function loadEvents() {
    setEventsError(null)
    setLoadingEvents(true)
    try {
      // Operators can only read their own events by rules; we also query by createdBy for efficiency.
      // IMPORTANT: Avoid requiring a composite index for (createdBy + orderBy startAt) by sorting client-side.
      const base = collection(db, 'events')
      const q =
        props.user.role === 'OPERADOR'
          ? query(base, where('createdBy', '==', props.user.uid), limit(2000))
          : query(base, orderBy('startAt', 'desc'), limit(2000))

      const snap = await getDocs(q)
      const items: StoredEvent[] = snap.docs
        .map((d) => {
          const data = d.data() as Record<string, unknown>
          const startAt = toDateSafe(data.startAt)
          const endAt = toDateSafe(data.endAt)
          if (!startAt || !endAt) return null

          return {
            id: d.id,
            createdBy: (data.createdBy as string) ?? '',
            createdByEmail: data.createdByEmail as string | undefined,
            createdAt: toDateSafe(data.createdAt),
            updatedAt: toDateSafe(data.updatedAt),
            pump: (data.pump as Pump) ?? 1,
            shiftDate: (data.shiftDate as string) ?? '',
            shift: (data.shift as Shift) ?? 'MANHA',
            category: (data.category as ActivityCategory) ?? 'Produtivo',
            startAt,
            endAt,
            clientId: data.clientId as string | undefined,
            clientName: data.clientName as string | undefined,
            truckPlate: data.truckPlate as string | undefined,
            containerId: data.containerId as string | undefined,
            notes: data.notes as string | undefined,
          }
        })
        .filter(Boolean) as StoredEvent[]

      // Keep the same UI ordering regardless of Firestore query ordering.
      items.sort((a, b) => b.startAt.getTime() - a.startAt.getTime())

      setEvents(items)
    } catch (e) {
      setEventsError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingEvents(false)
    }
  }

  useEffect(() => {
    void loadClients()
    void loadEvents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.user.uid, props.user.role])


  function setDraftPatch(patch: Partial<typeof draft>) {
    setDraft((prev) => ({ ...prev, ...patch }))
  }

  async function save() {
    if (validation.errors.length > 0) return
    if (!validation.startAt || !validation.endAt) return

    const id = nowId()

    const clientId = draft.category === 'Produtivo' && draft.clientId ? draft.clientId : undefined
    const clientName = clientId ? clients.find((c) => c.id === clientId)?.name : undefined

    const truckPlate = draft.truckPlate.trim() ? draft.truckPlate.trim().toUpperCase() : undefined
    const containerId = draft.containerId.trim() ? draft.containerId.trim().toUpperCase() : undefined
    const notes = draft.notes.trim() ? draft.notes.trim() : undefined

    // Firestore NÃO aceita `undefined`. Campos opcionais devem ser omitidos quando vazios.
    const payload: Record<string, unknown> = {
      createdBy: props.user.uid,
      createdByEmail: props.user.email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      pump: selectedPump,
      shiftDate: draft.shiftDate,
      shift: draft.shift,
      category: draft.category,
      startAt: validation.startAt,
      endAt: validation.endAt,
      ...(clientId ? { clientId } : {}),
      ...(clientName ? { clientName } : {}),
      ...(truckPlate ? { truckPlate } : {}),
      ...(containerId ? { containerId } : {}),
      ...(notes ? { notes } : {}),
    }

    if (import.meta.env.DEV) {
      const keys = Object.keys(payload)
      const undefinedKeys = keys.filter((k) => (payload as Record<string, unknown>)[k] === undefined)

      const preview = Object.fromEntries(
        keys.map((k) => {
          const v = (payload as Record<string, unknown>)[k]
          if (v === undefined) return [k, '<<undefined>>']
          if (v === null) return [k, '<<null>>']
          if (v instanceof Date) return [k, v.toISOString()]
          // serverTimestamp() is a Firestore FieldValue (not JSON-serializable). We keep it readable.
          if (typeof v === 'object') return [k, '<<object>>']
          return [k, v]
        }),
      )

      // eslint-disable-next-line no-console
      console.log('[events.save] id=', id)
      // eslint-disable-next-line no-console
      console.log('[events.save] category=', draft.category, 'shiftDate=', draft.shiftDate, 'shift=', draft.shift, 'pump=', selectedPump)
      // eslint-disable-next-line no-console
      console.log('[events.save] payload keys(json)=', JSON.stringify(keys))
      // eslint-disable-next-line no-console
      console.log('[events.save] undefined keys(json)=', JSON.stringify(undefinedKeys))
      // eslint-disable-next-line no-console
      console.log('[events.save] payload preview(json)=', JSON.stringify(preview))
    }

    try {
      await setDoc(doc(db, 'events', id), payload, { merge: false })
      // Optimistic local add (so it shows imediatamente)
      const record: StoredEvent = {
        id,
        createdBy: props.user.uid,
        createdByEmail: props.user.email,
        pump: selectedPump,
        shiftDate: draft.shiftDate,
        shift: draft.shift,
        category: draft.category,
        startAt: validation.startAt,
        endAt: validation.endAt,
        ...(clientId ? { clientId } : {}),
        ...(clientName ? { clientName } : {}),
        ...(truckPlate ? { truckPlate } : {}),
        ...(containerId ? { containerId } : {}),
        ...(notes ? { notes } : {}),
      }
      setEvents((prev) => [record, ...prev])
    } catch (e) {
      setEventsError(e instanceof Error ? e.message : String(e))
      return
    }

    // Reset only fields that are typically per-event
    setDraft((prev) => ({
      ...prev,
      startHHMM: '',
      endHHMM: '',
      truckPlate: '',
      containerId: '',
      notes: '',
    }))
  }

  function exportCsv() {
    const header = [
      'shiftDate',
      'shift',
      'pump',
      'category',
      'clientName',
      'startAt',
      'endAt',
      'durationMinutes',
      'truckPlate',
      'containerId',
      'notes',
      'createdByEmail',
    ]

    const rows = filteredEvents.map((e) => {
      const durationMinutes = Math.floor((e.endAt.getTime() - e.startAt.getTime()) / 60000)
      return [
        csvEscape(e.shiftDate),
        csvEscape(e.shift),
        csvEscape(e.pump),
        csvEscape(e.category),
        csvEscape(e.clientName ?? ''),
        csvEscape(e.startAt.toISOString()),
        csvEscape(e.endAt.toISOString()),
        csvEscape(durationMinutes),
        csvEscape(e.truckPlate ?? ''),
        csvEscape(e.containerId ?? ''),
        csvEscape(e.notes ?? ''),
        csvEscape(e.createdByEmail ?? ''),
      ].join(';')
    })

    const csv = [header.join(';'), ...rows].join('\n')
    const name = `transbordo_events_${filterFrom || 'all'}_${filterTo || 'all'}.csv`
    downloadCsv(name, csv)
  }

  return (
    <div className="tp-page">
      <header className="tp-header">
        <div>
          <div style={{ fontWeight: 700 }}>Transbordo</div>
          <div style={{ opacity: 0.8, fontSize: 13 }}>
            {props.user.email} • {props.user.role}
          </div>
        </div>

        <div className="tp-row-wrap">
          <ThemeSelect mode={props.themeMode} onChange={props.onThemeModeChange} />
          <button onClick={props.onLogout}>Sair</button>
        </div>
      </header>

      <section className="tp-section">
        <div className="tp-row-wrap">
          <span style={{ fontWeight: 600 }}>Bomba:</span>

          <button
            type="button"
            className={`tp-pump-btn ${selectedPump === 1 ? 'tp-pump-btn--active' : ''}`}
            aria-pressed={selectedPump === 1}
            onClick={() => setSelectedPump(1)}
            title={selectedPump === 1 ? 'Bomba 1 (selecionada)' : 'Selecionar Bomba 1'}
          >
            1
          </button>

          <button
            type="button"
            className={`tp-pump-btn ${selectedPump === 2 ? 'tp-pump-btn--active' : ''}`}
            aria-pressed={selectedPump === 2}
            onClick={() => setSelectedPump(2)}
            title={selectedPump === 2 ? 'Bomba 2 (selecionada)' : 'Selecionar Bomba 2'}
          >
            2
          </button>
        </div>

        <div className="tp-card">
          <div className="tp-card-header">
            <div style={{ fontWeight: 700 }}>Novo lançamento</div>
            <button disabled={validation.errors.length > 0} onClick={() => void save()} title={validation.errors.length > 0 ? validation.errors.join(' ') : 'Salvar'}>
              Salvar
            </button>
          </div>

          <div className="tp-form">
            <div className="tp-grid-2">
              <label style={{ display: 'grid', gap: 6 }}>
                Data do turno (dia de início)
                <input
                  type="date"
                  value={draft.shiftDate}
                  onChange={(e) => setDraftPatch({ shiftDate: e.target.value })}
                  style={{ padding: 10 }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                Turno
                <select value={draft.shift} onChange={(e) => setDraftPatch({ shift: e.target.value as Shift })} style={{ padding: 10 }}>
                  <option value="MANHA">Manhã (06:00–15:00)</option>
                  <option value="NOITE">Tarde/Noite (15:00–00:48)</option>
                </select>
              </label>
            </div>

            <div className="tp-grid-2">
              <label style={{ display: 'grid', gap: 6 }}>
                Início (HH:MM)
                <input
                  value={draft.startHHMM}
                  onChange={(e) => setDraftPatch({ startHHMM: e.target.value })}
                  placeholder="Ex: 15:20"
                  inputMode="numeric"
                  style={{ padding: 10 }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                Fim (HH:MM)
                <input
                  value={draft.endHHMM}
                  onChange={(e) => setDraftPatch({ endHHMM: e.target.value })}
                  placeholder="Ex: 16:05"
                  inputMode="numeric"
                  style={{ padding: 10 }}
                />
              </label>
            </div>

            <div className="tp-category-grid">
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setDraftPatch({ category: c })}
                  className={`tp-category-btn ${draft.category === c ? 'tp-category-btn--active' : ''}`}
                >
                  <div style={{ fontWeight: 700 }}>{c}</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    {c === 'Produtivo'
                      ? 'Exige Cliente + Placa + Container (validação rígida)'
                      : categoriesRequiringNotes.has(c)
                        ? 'Observações obrigatória'
                        : '—'}
                  </div>
                </button>
              ))}
            </div>

            {draft.category === 'Produtivo' && (
              <div style={{ display: 'grid', gap: 10 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  Cliente (obrigatório em Produtivo)
                  <select value={draft.clientId} onChange={(e) => setDraftPatch({ clientId: e.target.value })} style={{ padding: 10 }}>
                    <option value="">Selecione…</option>
                    {activeClients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {clientsError ? (
                    <span style={{ fontSize: 12 }} className="tp-danger-text">
                      {clientsError}
                    </span>
                  ) : null}
                  {!clientsError && !loadingClients && activeClients.length === 0 ? (
                    <span style={{ fontSize: 12 }} className="tp-danger-text">
                      Nenhum cliente ativo cadastrado. Um Admin precisa cadastrar em “Clientes”.
                    </span>
                  ) : null}
                </label>

                <label style={{ display: 'grid', gap: 6 }}>
                  Placa (obrigatório em Produtivo)
                  <input
                    value={draft.truckPlate}
                    onChange={(e) => setDraftPatch({ truckPlate: e.target.value })}
                    placeholder="ABC1234 ou ABC1D23"
                    style={{ padding: 10 }}
                  />
                  {draft.truckPlate && !isMercosulOrOldPlate(draft.truckPlate) && (
                    <span style={{ fontSize: 12 }} className="tp-danger-text">
                      Formato inválido de placa.
                    </span>
                  )}
                </label>

                <label style={{ display: 'grid', gap: 6 }}>
                  Container (obrigatório em Produtivo)
                  <input
                    value={draft.containerId}
                    onChange={(e) => setDraftPatch({ containerId: e.target.value })}
                    placeholder="ABCD 123456-7"
                    style={{ padding: 10 }}
                  />
                  {draft.containerId && !isContainerId(draft.containerId) && (
                    <span style={{ fontSize: 12 }} className="tp-danger-text">
                      Formato inválido de container.
                    </span>
                  )}
                </label>

                <label style={{ display: 'grid', gap: 6 }}>
                  Observações (opcional em Produtivo)
                  <input
                    value={draft.notes}
                    onChange={(e) => setDraftPatch({ notes: e.target.value })}
                    placeholder="Ex: Troca de container, ajuste, observação do operador..."
                    style={{ padding: 10 }}
                  />
                </label>
              </div>
            )}

            {draft.category !== 'Produtivo' && categoriesRequiringNotes.has(draft.category) && (
              <label style={{ display: 'grid', gap: 6 }}>
                Observações (obrigatória em {draft.category})
                <input
                  value={draft.notes}
                  onChange={(e) => setDraftPatch({ notes: e.target.value })}
                  placeholder="Descreva..."
                  style={{ padding: 10 }}
                />
              </label>
            )}

            {validation.errors.length > 0 && (
              <div className="tp-panel-danger">
                <div style={{ fontWeight: 700 }} className="tp-danger-text">
                  Pendências
                </div>
                <ul style={{ margin: '8px 0 0 18px' }} className="tp-danger-text">
                  {validation.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )}

            {eventsError ? (
              <div style={{ marginTop: 6, fontSize: 13, whiteSpace: 'pre-wrap' }} className="tp-danger-text">
                {eventsError}
              </div>
            ) : null}
          </div>
        </div>

        {props.user.role === 'ADMIN' ? (
          <div className="tp-card">
            <div className="tp-card-header">
              <div style={{ fontWeight: 700 }}>Clientes (Admin)</div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                {loadingClients ? 'Carregando…' : `${clients.length} cadastrado(s)`}
              </div>
            </div>

            <div className="tp-stack-10">
              <div className="tp-actions-row">
                <input
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="Nome do cliente"
                  style={{ padding: 10, minWidth: 260, flex: 1 }}
                />
                <button
                  disabled={savingClient || !newClientName.trim()}
                  onClick={() => {
                    void (async () => {
                      try {
                        setSavingClient(true)
                        await upsertClient({ name: newClientName, active: true })
                        setNewClientName('')
                      } finally {
                        setSavingClient(false)
                      }
                    })()
                  }}
                >
                  {savingClient ? 'Salvando…' : 'Adicionar cliente'}
                </button>
                <button onClick={() => void loadClients()} disabled={loadingClients}>
                  Atualizar
                </button>
              </div>

              {clientsError ? (
                <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }} className="tp-danger-text">
                  {clientsError}
                </div>
              ) : null}

              {clients.length === 0 ? (
                <div style={{ opacity: 0.75, fontSize: 13 }}>Nenhum cliente cadastrado ainda.</div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {clients.map((c) => (
                    <div
                      key={c.id}
                      className="tp-client-row"
                      style={{
                        border: '1px solid var(--tp-border)',
                        borderRadius: 8,
                        padding: 10,
                        background: 'var(--tp-surface)',
                        color: 'var(--tp-text)',
                      }}
                    >
                      <input
                        value={c.name}
                        onChange={(e) =>
                          setClients((prev) => prev.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)))
                        }
                        onBlur={() => void upsertClient({ id: c.id, name: c.name, active: c.active })}
                        style={{ padding: 10 }}
                      />
                      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={c.active}
                          onChange={(e) => {
                            const active = e.target.checked
                            setClients((prev) => prev.map((x) => (x.id === c.id ? { ...x, active } : x)))
                            void upsertClient({ id: c.id, name: c.name, active })
                          }}
                        />
                        Ativo
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div className="tp-card">
          <div className="tp-card-header">
            <div style={{ fontWeight: 700 }}>Histórico</div>
            <div className="tp-row-wrap">
              <button onClick={() => void loadEvents()} disabled={loadingEvents}>
                {loadingEvents ? 'Atualizando…' : 'Atualizar'}
              </button>
              <button onClick={exportCsv} disabled={filteredEvents.length === 0}>
                Exportar CSV ({filteredEvents.length})
              </button>
            </div>
          </div>

          <div className="tp-grid-5" style={{ marginTop: 10 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              De
              <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} style={{ padding: 8 }} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              Até
              <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} style={{ padding: 8 }} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              Bomba
              <select
                value={filterPump}
                onChange={(e) => setFilterPump((e.target.value === 'ALL' ? 'ALL' : Number(e.target.value)) as 'ALL' | Pump)}
                style={{ padding: 8 }}
              >
                <option value="ALL">Todas</option>
                <option value="1">1</option>
                <option value="2">2</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              Turno
              <select value={filterShift} onChange={(e) => setFilterShift(e.target.value as 'ALL' | Shift)} style={{ padding: 8 }}>
                <option value="ALL">Todos</option>
                <option value="MANHA">MANHA</option>
                <option value="NOITE">NOITE</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              Categoria
              <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value as 'ALL' | ActivityCategory)} style={{ padding: 8 }}>
                <option value="ALL">Todas</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ marginTop: 10, opacity: 0.8, fontSize: 12 }}>
            {props.user.role === 'OPERADOR'
              ? 'Operador: você vê apenas seus lançamentos.'
              : 'Supervisor/Admin: você pode ver e exportar todos os lançamentos.'}
          </div>

          {filteredEvents.length === 0 ? (
            <div style={{ marginTop: 10, opacity: 0.75 }}>Sem registros para os filtros atuais.</div>
          ) : (
            <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
              {filteredEvents.slice(0, 200).map((e) => (
                <div key={e.id} className="tp-event-row">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ fontWeight: 700 }}>
                      {e.shiftDate} • {e.shift} • B{e.pump} • {e.category}
                    </div>
                    <div style={{ opacity: 0.8 }}>{formatDurationMinutes(e.startAt, e.endAt)}</div>
                  </div>

                  <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
                    {e.startAt.toLocaleTimeString()} → {e.endAt.toLocaleTimeString()}
                  </div>

                  <div style={{ marginTop: 6, fontSize: 13, opacity: 0.9 }}>
                    {e.category === 'Produtivo' ? (
                      <>
                        <span><b>Cliente:</b> {e.clientName ?? '-'}</span>
                        {' '}
                        • <span><b>Placa:</b> {e.truckPlate ?? '-'}</span> • <span><b>Container:</b> {e.containerId ?? '-'}</span>
                        {e.notes ? (
                          <>
                            {' '}
                            • <span><b>Obs:</b> {e.notes}</span>
                          </>
                        ) : null}
                      </>
                    ) : (
                      <span><b>Obs:</b> {e.notes ?? '-'}</span>
                    )}
                  </div>

                  {props.user.role !== 'OPERADOR' ? (
                    <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                      Criado por: {e.createdByEmail ?? e.createdBy}
                    </div>
                  ) : null}
                </div>
              ))}
              {filteredEvents.length > 200 ? (
                <div style={{ opacity: 0.7, fontSize: 12 }}>
                  Mostrando os primeiros 200 registros (use filtros para refinar).
                </div>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <AppFooter />
    </div>
  )
}

export default App
