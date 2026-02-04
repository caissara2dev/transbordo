import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { Link, NavLink, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom'
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
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
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
  where,
} from 'firebase/firestore'
import { auth, db } from './firebase'
import './App.css'

type ThemeMode = 'system' | 'light' | 'dark'

const THEME_STORAGE_KEY = 'tp.theme'
const UPDATE_NOTICE_DISMISSED_KEY = 'tp.update_notice.dismissed'
const SIDEBAR_OPEN_KEY = 'tp.sidebar.open'

function readUpdateNoticeDismissed(): boolean {
  return localStorage.getItem(UPDATE_NOTICE_DISMISSED_KEY) === '1'
}

function persistUpdateNoticeDismissed() {
  localStorage.setItem(UPDATE_NOTICE_DISMISSED_KEY, '1')
}

function readThemeMode(): ThemeMode {
  const raw = localStorage.getItem(THEME_STORAGE_KEY)
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  return 'system'
}

function persistThemeMode(mode: ThemeMode) {
  localStorage.setItem(THEME_STORAGE_KEY, mode)
}

function readSidebarOpen(): boolean {
  return localStorage.getItem(SIDEBAR_OPEN_KEY) === '1'
}

function persistSidebarOpen(value: boolean) {
  localStorage.setItem(SIDEBAR_OPEN_KEY, value ? '1' : '0')
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

function UpdateNoticeModal(props: { onDismiss: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Aviso de atualização"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0,0,0,0.55)',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
      }}
    >
      <div
        className="tp-card"
        style={{
          width: 'min(720px, 100%)',
          border: '1px solid var(--tp-border)',
          boxShadow: '0 14px 50px rgba(0,0,0,0.35)',
        }}
      >
        <div className="tp-card-header">
          <div style={{ fontWeight: 800 }}>Novidades no Transbordo</div>
          <button type="button" onClick={props.onDismiss} title="Fechar">
            Fechar
          </button>
        </div>

        <div style={{ padding: 14, display: 'grid', gap: 10 }}>
          <p style={{ margin: 0, opacity: 0.9 }}>
            Estamos evoluindo o sistema para deixar a operação ainda mais ágil, consistente e auditável.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
            <li>Supervisores e Admins agora podem editar lançamentos.</li>
            <li>Correção de placa, container e horários ficou mais simples.</li>
            <li>Cada edição fica registrada com histórico completo para auditoria.</li>
            <li>Horário em formato 24h (HH:MM) também na edição.</li>
          </ul>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <button type="button" onClick={props.onDismiss} style={{ padding: 12 }}>
              Entendi
            </button>
          </div>
        </div>
      </div>
    </div>
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
  | 'Em trânsito'
  | 'Aguardando laboratório'
  | 'Sem caminhão'
  | 'Sem container'
  | 'Manutenção'
  | 'Outros'

type Shift = 'MANHA' | 'NOITE'

const CATEGORIES: ActivityCategory[] = [
  'Produtivo',
  'Em trânsito',
  'Aguardando laboratório',
  'Sem caminhão',
  'Sem container',
  'Manutenção',
  'Outros',
]

const CATEGORY_COLORS: Record<ActivityCategory, string> = {
  Produtivo: '#16a34a',
  'Em trânsito': '#2563eb',
  'Aguardando laboratório': '#f59e0b',
  'Sem caminhão': '#dc2626',
  'Sem container': '#7c3aed',
  Manutenção: '#0ea5e9',
  Outros: '#64748b',
}

const NAV_ITEMS: Array<{ label: string; to: string; short: string; roles: Role[] }> = [
  { label: 'Operação', to: '/app', short: 'OP', roles: ['OPERADOR', 'SUPERVISOR', 'ADMIN'] },
  { label: 'Indicadores', to: '/app/indicadores', short: 'KP', roles: ['SUPERVISOR', 'ADMIN'] },
]

type DateRangePreset = 'TODAY' | 'YESTERDAY' | 'WEEK' | 'LAST_WEEK' | 'MONTH' | 'LAST_MONTH' | 'CUSTOM'

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
  updatedBy?: string
  updatedByEmail?: string
}

type EventDraft = {
  shiftDate: string
  shift: Shift
  category: ActivityCategory
  startHHMM: string
  endHHMM: string
  clientId: string
  truckPlate: string
  containerId: string
  notes: string
}

type EditDraft = EventDraft & {
  pump: Pump
}

function AppShell(props: {
  user: User
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
  onLogout: () => void
}) {
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => readSidebarOpen())

  useEffect(() => {
    persistSidebarOpen(sidebarOpen)
  }, [sidebarOpen])

  useEffect(() => {
    if (!sidebarOpen) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [sidebarOpen])

  const navItems = useMemo(() => NAV_ITEMS.filter((item) => item.roles.includes(props.user.role)), [props.user.role])

  return (
    <div className="tp-shell">
      <div className={`tp-drawer ${sidebarOpen ? 'is-open' : ''}`} aria-hidden={!sidebarOpen}>
        <div className="tp-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
        <aside className="tp-drawer__panel" id="tp-drawer-panel">
          <div className="tp-sidebar__inner">
            <div className="tp-sidebar__brand">
              <span className="tp-sidebar__brand-text">Transbordo</span>
              <button
                type="button"
                className="tp-sidebar__close"
                onClick={() => setSidebarOpen(false)}
                aria-label="Fechar menu"
                title="Fechar menu"
              >
                X
              </button>
            </div>

            <nav className="tp-sidebar__nav">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/app'}
                  onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) => `tp-sidebar__link ${isActive ? 'is-active' : ''}`}
                >
                  <span className="tp-sidebar__icon" aria-hidden="true">
                    {item.short}
                  </span>
                  <span className="tp-sidebar__label">{item.label}</span>
                </NavLink>
              ))}
            </nav>

            <div className="tp-sidebar__footer">
              <div className="tp-sidebar__user">{props.user.email}</div>
              <div className="tp-sidebar__role">{props.user.role}</div>
            </div>
          </div>
        </aside>
      </div>

      <div className="tp-shell-main">
        <header className="tp-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              className="tp-hamburger"
              onClick={() => setSidebarOpen(true)}
              aria-label="Abrir menu"
              aria-expanded={sidebarOpen}
              aria-controls="tp-drawer-panel"
            >
              <span className="tp-hamburger__bar" />
              <span className="tp-hamburger__bar" />
              <span className="tp-hamburger__bar" />
            </button>
            <div style={{ display: 'grid', gap: 2 }}>
              <div style={{ fontWeight: 700 }}>Transbordo</div>
              <div style={{ opacity: 0.8, fontSize: 13 }}>
                {props.user.email} • {props.user.role}
              </div>
            </div>
          </div>

          <div className="tp-row-wrap">
            <ThemeSelect mode={props.themeMode} onChange={props.onThemeModeChange} />
            <button onClick={props.onLogout}>Sair</button>
          </div>
        </header>

        <div className="tp-shell-content">
          <Outlet />
        </div>
      </div>
    </div>
  )
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

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, amount: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + amount)
  return d
}

function startOfWeekMonday(date: Date): Date {
  const d = startOfDay(date)
  const day = d.getDay()
  const diff = (day + 6) % 7
  d.setDate(d.getDate() - diff)
  return d
}

function endOfWeekMonday(date: Date): Date {
  return addDays(startOfWeekMonday(date), 6)
}

function startOfMonth(date: Date): Date {
  return startOfDay(new Date(date.getFullYear(), date.getMonth(), 1))
}

function endOfMonth(date: Date): Date {
  return startOfDay(new Date(date.getFullYear(), date.getMonth() + 1, 0))
}

function formatMinutesAsHM(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes))
  const hours = Math.floor(safe / 60)
  const minutes = safe % 60
  if (hours <= 0) return `${minutes} min`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

function formatAxisHours(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes))
  const hours = Math.floor(safe / 60)
  return `${hours}h`
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%'
  return `${value.toFixed(1).replace('.', ',')}%`
}

function formatShortDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function getPresetRange(preset: DateRangePreset, baseDate: Date = new Date()): { from: string; to: string } {
  const today = startOfDay(baseDate)

  if (preset === 'TODAY') {
    const iso = localISODate(today)
    return { from: iso, to: iso }
  }

  if (preset === 'YESTERDAY') {
    const y = addDays(today, -1)
    const iso = localISODate(y)
    return { from: iso, to: iso }
  }

  if (preset === 'WEEK') {
    const start = startOfWeekMonday(today)
    const end = endOfWeekMonday(today)
    return { from: localISODate(start), to: localISODate(end) }
  }

  if (preset === 'LAST_WEEK') {
    const start = addDays(startOfWeekMonday(today), -7)
    const end = addDays(start, 6)
    return { from: localISODate(start), to: localISODate(end) }
  }

  if (preset === 'MONTH') {
    const start = startOfMonth(today)
    const end = endOfMonth(today)
    return { from: localISODate(start), to: localISODate(end) }
  }

  if (preset === 'LAST_MONTH') {
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const start = startOfMonth(lastMonth)
    const end = endOfMonth(lastMonth)
    return { from: localISODate(start), to: localISODate(end) }
  }

  const iso = localISODate(today)
  return { from: iso, to: iso }
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
              <AppShell
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
      >
        {user && user.approved ? (
          <>
            <Route index element={<FieldPage user={user} />} />
            <Route path="indicadores" element={<IndicatorsPage user={user} />} />
          </>
        ) : null}
      </Route>
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

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (busy || !email.trim() || password.length < 6) return
          void handleLogin()
        }}
      >
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
            type="submit"
            style={{ padding: 12, width: '100%' }}
            disabled={busy || !email.trim() || password.length < 6}
            title={password.length < 6 ? 'Senha precisa ter pelo menos 6 caracteres' : 'Entrar'}
          >
            {busy ? 'Aguarde…' : 'Entrar'}
          </button>

          <button
            type="button"
            style={{ padding: 12, width: '100%' }}
            onClick={handleSignup}
            disabled={busy || !email.trim() || password.length < 6}
            title={password.length < 6 ? 'Senha precisa ter pelo menos 6 caracteres' : 'Criar conta'}
          >
            {busy ? 'Aguarde…' : 'Criar conta'}
          </button>
        </div>
      </form>

      <p style={{ opacity: 0.7, fontSize: 12, marginTop: 12 }}>
        Observação: por padrão, novos usuários entram como <b>OPERADOR</b> e depois podem ser promovidos por um Admin.
      </p>

      <AppFooter />
    </div>
  )
}

const TIME_SLOTS_EMPTY: string = '____'

function slotsToMaskedHHMM(slots: string): string {
  // slots is 4 chars: HHMM, using '_' for missing digits
  return `${slots[0] ?? '_'}${slots[1] ?? '_'}:${slots[2] ?? '_'}${slots[3] ?? '_'}`
}

function slotsToHHMM(slots: string): string | '' {
  if (slots.length !== 4) return ''
  if (slots.includes('_')) return ''
  const hh = Number(slots.slice(0, 2))
  const mm = Number(slots.slice(2, 4))
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return ''
  if (hh < 0 || hh > 23) return ''
  if (mm < 0 || mm > 59) return ''
  return `${slots.slice(0, 2)}:${slots.slice(2, 4)}`
}

function hhmmToSlots(hhmm: string): string {
  const clean = hhmm.replace(':', '')
  if (!/^\d{4}$/.test(clean)) return TIME_SLOTS_EMPTY
  return clean
}

function canSetSlotDigit(slots: string, idx: number, digit: string): boolean {
  // idx: 0..3, digit: '0'..'9'
  if (!/^\d$/.test(digit)) return false

  // Build prospective slots
  const next = slots.split('')
  next[idx] = digit

  // Validate partially (reject impossible times early)
  const h0 = next[0]
  const h1 = next[1]
  const m0 = next[2]
  // const m1 = next[3]

  // Hours tens
  if (h0 !== '_' && Number(h0) > 2) return false

  // Hours ones
  if (h0 !== '_' && h1 !== '_') {
    const hh = Number(h0 + h1)
    if (hh > 23) return false
  }

  // Minutes tens
  if (m0 !== '_' && Number(m0) > 5) return false

  // Full validation when complete
  if (!next.includes('_')) {
    const hh = Number(next[0] + next[1])
    const mm = Number(next[2] + next[3])
    if (hh > 23) return false
    if (mm > 59) return false
  }

  return true
}

function lastFilledIndex(slots: string): number {
  for (let i = 3; i >= 0; i--) {
    if (slots[i] !== '_') return i
  }
  return -1
}

function nextEmptyIndex(slots: string): number {
  return slots.indexOf('_')
}

function slotIndexToCaretPos(idx: number): number {
  // Mask is "HH:MM" (len 5). Editable positions are 0,1,3,4.
  // Slot index 0..3 maps to caret positions 0,1,3,4.
  return idx <= 1 ? idx : idx + 1
}

function caretPosForNextInput(slots: string): number {
  const next = nextEmptyIndex(slots)
  return next === -1 ? 5 : slotIndexToCaretPos(next)
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

function toHHMM(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function validateEventDraft(
  draft: EventDraft,
  clients: Client[],
  categoriesRequiringNotes: Set<ActivityCategory>,
  opts?: { allowInactiveClientId?: string },
): { errors: string[]; startAt: Date | null; endAt: Date | null } {
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
  const needsTruckPlate = draft.category === 'Produtivo' || draft.category === 'Em trânsito'
  const needsContainer = draft.category === 'Produtivo'

  if (!draft.clientId) {
    errors.push('Cliente obrigatório.')
  } else {
    const c = clients.find((x) => x.id === draft.clientId)
    if (!c) errors.push('Cliente selecionado não existe (atualize a lista).')
    else if (!c.active && draft.clientId !== opts?.allowInactiveClientId) {
      errors.push('Cliente selecionado está inativo.')
    }
  }

  if (needsTruckPlate) {
    if (!draft.truckPlate.trim() || !isMercosulOrOldPlate(draft.truckPlate)) {
      errors.push(`${draft.category}: Placa obrigatória e deve estar em formato válido.`)
    }
  }

  if (needsContainer) {
    if (!draft.containerId.trim() || !isContainerId(draft.containerId)) {
      errors.push('Produtivo: Container obrigatório e deve estar em formato válido.')
    }
  }

  if (needsNotes) {
    if (!draft.notes.trim()) errors.push(`${draft.category}: Observações obrigatória.`)
  }

  return { errors, startAt, endAt }
}

function eventToPlain(e: StoredEvent): Record<string, unknown> {
  const data: Record<string, unknown> = {
    createdBy: e.createdBy,
    pump: e.pump,
    shiftDate: e.shiftDate,
    shift: e.shift,
    category: e.category,
    startAt: e.startAt,
    endAt: e.endAt,
    ...(e.createdByEmail ? { createdByEmail: e.createdByEmail } : {}),
    ...(e.createdAt ? { createdAt: e.createdAt } : {}),
    ...(e.updatedAt ? { updatedAt: e.updatedAt } : {}),
    ...(e.updatedBy ? { updatedBy: e.updatedBy } : {}),
    ...(e.updatedByEmail ? { updatedByEmail: e.updatedByEmail } : {}),
    ...(e.clientId ? { clientId: e.clientId } : {}),
    ...(e.clientName ? { clientName: e.clientName } : {}),
    ...(e.truckPlate ? { truckPlate: e.truckPlate } : {}),
    ...(e.containerId ? { containerId: e.containerId } : {}),
    ...(e.notes ? { notes: e.notes } : {}),
  }
  return data
}

function FieldPage(props: { user: User }) {
  const todayISO = localISODate()
  const [showUpdateNotice, setShowUpdateNotice] = useState<boolean>(() => !readUpdateNoticeDismissed())

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

  const [draft, setDraft] = useState<EventDraft>({
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

  const [editingEventId, setEditingEventId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [editing, setEditing] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // If the user manually changes the Shift select, we stop auto-switching.
  const [shiftTouched, setShiftTouched] = useState(false)

  // Auto-switch to NOITE after 15:00 (local time) IF the user hasn't touched the Shift select.
  useEffect(() => {
    if (shiftTouched) return

    const tick = () => {
      const now = new Date()
      const nowMinutes = now.getHours() * 60 + now.getMinutes()
      const today = localISODate(now)

      // Only auto-switch when the shiftDate is "today" (start-day of the shift).
      if (draft.shiftDate !== today) return
      if (nowMinutes < 15 * 60) return

      setDraft((prev) => (prev.shift === 'NOITE' ? prev : { ...prev, shift: 'NOITE' }))
    }

    tick()
    const id = window.setInterval(tick, 30_000)
    return () => window.clearInterval(id)
  }, [draft.shiftDate, shiftTouched])

  // Rigid time mask inputs (HH:MM), internally stores 4 slots: HHMM with '_' placeholders.
  const [startSlots, setStartSlots] = useState<string>(TIME_SLOTS_EMPTY)
  const [endSlots, setEndSlots] = useState<string>(TIME_SLOTS_EMPTY)
  const [editStartSlots, setEditStartSlots] = useState<string>(TIME_SLOTS_EMPTY)
  const [editEndSlots, setEditEndSlots] = useState<string>(TIME_SLOTS_EMPTY)

  const startInputRef = useRef<HTMLInputElement | null>(null)
  const endInputRef = useRef<HTMLInputElement | null>(null)
  const editStartInputRef = useRef<HTMLInputElement | null>(null)
  const editEndInputRef = useRef<HTMLInputElement | null>(null)

  function setDraftPatch(patch: Partial<typeof draft>) {
    setDraft((prev) => ({ ...prev, ...patch }))
  }

  function setEditDraftPatch(patch: Partial<EditDraft>) {
    setEditDraft((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  function startEdit(event: StoredEvent) {
    setEditError(null)
    setEditingEventId(event.id)
    setEditStartSlots(hhmmToSlots(toHHMM(event.startAt)))
    setEditEndSlots(hhmmToSlots(toHHMM(event.endAt)))
    setEditDraft({
      pump: event.pump,
      shiftDate: event.shiftDate,
      shift: event.shift,
      category: event.category,
      startHHMM: toHHMM(event.startAt),
      endHHMM: toHHMM(event.endAt),
      clientId: event.clientId ?? '',
      truckPlate: event.truckPlate ?? '',
      containerId: event.containerId ?? '',
      notes: event.notes ?? '',
    })
  }

  function cancelEdit() {
    setEditingEventId(null)
    setEditDraft(null)
    setEditError(null)
    setEditStartSlots(TIME_SLOTS_EMPTY)
    setEditEndSlots(TIME_SLOTS_EMPTY)
  }

  function syncDraftTimeFromSlots(kind: 'start' | 'end', slots: string) {
    const hhmm = slotsToHHMM(slots)
    if (kind === 'start') setDraftPatch({ startHHMM: hhmm })
    else setDraftPatch({ endHHMM: hhmm })
  }

  function applySlots(kind: 'start' | 'end', slots: string) {
    if (kind === 'start') setStartSlots(slots)
    else setEndSlots(slots)
    syncDraftTimeFromSlots(kind, slots)
    const ref = kind === 'start' ? startInputRef : endInputRef
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      const pos = caretPosForNextInput(slots)
      el.setSelectionRange(pos, pos)
    })
  }

  function handleMaskedTimeFocus(kind: 'start' | 'end') {
    const ref = kind === 'start' ? startInputRef : endInputRef
    const slots = kind === 'start' ? startSlots : endSlots
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      const pos = caretPosForNextInput(slots)
      el.setSelectionRange(pos, pos)
    })
  }

  function appendDigit(kind: 'start' | 'end', digit: string) {
    const slots = kind === 'start' ? startSlots : endSlots

    // If already complete, start a fresh entry
    if (!slots.includes('_')) {
      const fresh = TIME_SLOTS_EMPTY
      if (!canSetSlotDigit(fresh, 0, digit)) return
      const next = fresh.split('')
      next[0] = digit
      applySlots(kind, next.join(''))
      return
    }

    const idx = nextEmptyIndex(slots)
    if (idx === -1) return
    if (!canSetSlotDigit(slots, idx, digit)) return

    const next = slots.split('')
    next[idx] = digit
    applySlots(kind, next.join(''))
  }

  function backspaceDigit(kind: 'start' | 'end') {
    const slots = kind === 'start' ? startSlots : endSlots
    const idx = lastFilledIndex(slots)
    if (idx === -1) return
    const next = slots.split('')
    next[idx] = '_'
    applySlots(kind, next.join(''))
  }

  function clearAll(kind: 'start' | 'end') {
    applySlots(kind, TIME_SLOTS_EMPTY)
  }

  function handleMaskedTimeKeyDown(kind: 'start' | 'end', e: KeyboardEvent<HTMLInputElement>) {
    // Allow browser shortcuts (copy/paste/select all)
    if (e.metaKey || e.ctrlKey || e.altKey) return

    if (e.key === 'Tab' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') return

    if (e.key === 'Backspace') {
      e.preventDefault()
      backspaceDigit(kind)
      return
    }

    if (e.key === 'Delete') {
      e.preventDefault()
      clearAll(kind)
      return
    }

    if (/^\d$/.test(e.key)) {
      e.preventDefault()
      appendDigit(kind, e.key)
      return
    }

    // Block any other key from mutating the value (including ':')
    e.preventDefault()
  }

  function handleMaskedTimePaste(kind: 'start' | 'end', e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault()
    const raw = e.clipboardData.getData('text') ?? ''
    const digits = raw.replace(/\D/g, '').slice(0, 4)
    if (!digits) return

    // Fill sequentially from empty
    let slots = TIME_SLOTS_EMPTY
    for (const d of digits) {
      const idx = nextEmptyIndex(slots)
      if (idx === -1) break
      if (!canSetSlotDigit(slots, idx, d)) break
      const next = slots.split('')
      next[idx] = d
      slots = next.join('')
    }
    applySlots(kind, slots)
  }

  function syncEditDraftTimeFromSlots(kind: 'start' | 'end', slots: string) {
    const hhmm = slotsToHHMM(slots)
    if (kind === 'start') setEditDraftPatch({ startHHMM: hhmm })
    else setEditDraftPatch({ endHHMM: hhmm })
  }

  function applyEditSlots(kind: 'start' | 'end', slots: string) {
    if (kind === 'start') setEditStartSlots(slots)
    else setEditEndSlots(slots)
    syncEditDraftTimeFromSlots(kind, slots)
    const ref = kind === 'start' ? editStartInputRef : editEndInputRef
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      const pos = caretPosForNextInput(slots)
      el.setSelectionRange(pos, pos)
    })
  }

  function handleEditMaskedTimeFocus(kind: 'start' | 'end') {
    const ref = kind === 'start' ? editStartInputRef : editEndInputRef
    const slots = kind === 'start' ? editStartSlots : editEndSlots
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      const pos = caretPosForNextInput(slots)
      el.setSelectionRange(pos, pos)
    })
  }

  function appendEditDigit(kind: 'start' | 'end', digit: string) {
    const slots = kind === 'start' ? editStartSlots : editEndSlots

    if (!slots.includes('_')) {
      const fresh = TIME_SLOTS_EMPTY
      if (!canSetSlotDigit(fresh, 0, digit)) return
      const next = fresh.split('')
      next[0] = digit
      applyEditSlots(kind, next.join(''))
      return
    }

    const idx = nextEmptyIndex(slots)
    if (idx === -1) return
    if (!canSetSlotDigit(slots, idx, digit)) return

    const next = slots.split('')
    next[idx] = digit
    applyEditSlots(kind, next.join(''))
  }

  function backspaceEditDigit(kind: 'start' | 'end') {
    const slots = kind === 'start' ? editStartSlots : editEndSlots
    const idx = lastFilledIndex(slots)
    if (idx === -1) return
    const next = slots.split('')
    next[idx] = '_'
    applyEditSlots(kind, next.join(''))
  }

  function clearAllEdit(kind: 'start' | 'end') {
    applyEditSlots(kind, TIME_SLOTS_EMPTY)
  }

  function handleEditMaskedTimeKeyDown(kind: 'start' | 'end', e: KeyboardEvent<HTMLInputElement>) {
    if (e.metaKey || e.ctrlKey || e.altKey) return

    if (e.key === 'Tab' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') return

    if (e.key === 'Backspace') {
      e.preventDefault()
      backspaceEditDigit(kind)
      return
    }

    if (e.key === 'Delete') {
      e.preventDefault()
      clearAllEdit(kind)
      return
    }

    if (/^\d$/.test(e.key)) {
      e.preventDefault()
      appendEditDigit(kind, e.key)
      return
    }

    e.preventDefault()
  }

  function handleEditMaskedTimePaste(kind: 'start' | 'end', e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault()
    const raw = e.clipboardData.getData('text') ?? ''
    const digits = raw.replace(/\D/g, '').slice(0, 4)
    if (!digits) return

    let slots = TIME_SLOTS_EMPTY
    for (const d of digits) {
      const idx = nextEmptyIndex(slots)
      if (idx === -1) break
      if (!canSetSlotDigit(slots, idx, d)) break
      const next = slots.split('')
      next[idx] = d
      slots = next.join('')
    }
    applyEditSlots(kind, slots)
  }

  const validation = useMemo(
    () => validateEventDraft(draft, clients, categoriesRequiringNotes),
    [draft, categoriesRequiringNotes, clients],
  )

  const editingEvent = useMemo(
    () => (editingEventId ? events.find((e) => e.id === editingEventId) ?? null : null),
    [editingEventId, events],
  )

  const editClientOptions = useMemo(() => {
    if (!editDraft) return clients.filter((c) => c.active)
    const active = clients.filter((c) => c.active)
    const selected = editDraft.clientId ? clients.find((c) => c.id === editDraft.clientId) : null
    if (selected && !selected.active) return [...active, selected]
    return active
  }, [clients, editDraft])

  const editValidation = useMemo(() => {
    if (!editDraft) return { errors: [], startAt: null, endAt: null }
    return validateEventDraft(editDraft, clients, categoriesRequiringNotes, {
      allowInactiveClientId: editingEvent?.clientId,
    })
  }, [editDraft, clients, categoriesRequiringNotes, editingEvent?.clientId])

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
            updatedBy: data.updatedBy as string | undefined,
            updatedByEmail: data.updatedByEmail as string | undefined,
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

  useEffect(() => {
    if (editingEventId && !editingEvent) cancelEdit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingEventId, editingEvent])


  // setDraftPatch is defined above (used by masked time inputs)

  async function save() {
    if (validation.errors.length > 0) return
    if (!validation.startAt || !validation.endAt) return

    const id = nowId()

    const clientId = draft.clientId ? draft.clientId : undefined
    const clientName = clientId ? clients.find((c) => c.id === clientId)?.name : undefined

    const truckPlate =
      (draft.category === 'Produtivo' || draft.category === 'Em trânsito') && draft.truckPlate.trim()
        ? draft.truckPlate.trim().toUpperCase()
        : undefined
    const containerId =
      draft.category === 'Produtivo' && draft.containerId.trim() ? draft.containerId.trim().toUpperCase() : undefined
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
    setStartSlots(TIME_SLOTS_EMPTY)
    setEndSlots(TIME_SLOTS_EMPTY)
  }

  async function saveEdit() {
    if (!editDraft || !editingEvent) return
    if (props.user.role === 'OPERADOR') return
    if (editValidation.errors.length > 0) return
    if (!editValidation.startAt || !editValidation.endAt) return

    const clientId = editDraft.clientId ? editDraft.clientId : undefined
    if (!clientId) {
      setEditError('Cliente obrigatório.')
      return
    }

    setEditError(null)
    setEditing(true)
    const clientNameLookup = clientId ? clients.find((c) => c.id === clientId)?.name : undefined
    const clientIdChanged = clientId !== editingEvent.clientId
    const resolvedClientName = clientId
      ? clientNameLookup ?? (clientIdChanged ? undefined : editingEvent.clientName)
      : undefined

    const truckPlate =
      (editDraft.category === 'Produtivo' || editDraft.category === 'Em trânsito') && editDraft.truckPlate.trim()
        ? editDraft.truckPlate.trim().toUpperCase()
        : undefined
    const containerId =
      editDraft.category === 'Produtivo' && editDraft.containerId.trim()
        ? editDraft.containerId.trim().toUpperCase()
        : undefined
    const notes = editDraft.notes.trim() ? editDraft.notes.trim() : undefined

    const updateData: Record<string, unknown> = {
      pump: editDraft.pump,
      shiftDate: editDraft.shiftDate,
      shift: editDraft.shift,
      category: editDraft.category,
      startAt: editValidation.startAt,
      endAt: editValidation.endAt,
      clientId,
      updatedAt: serverTimestamp(),
      updatedBy: props.user.uid,
      updatedByEmail: props.user.email,
    }

    if (resolvedClientName) updateData.clientName = resolvedClientName
    else if (clientIdChanged) updateData.clientName = deleteField()

    updateData.truckPlate = truckPlate ? truckPlate : deleteField()
    updateData.containerId = containerId ? containerId : deleteField()
    updateData.notes = notes ? notes : deleteField()

    const afterEvent: StoredEvent = {
      ...editingEvent,
      pump: editDraft.pump,
      shiftDate: editDraft.shiftDate,
      shift: editDraft.shift,
      category: editDraft.category,
      startAt: editValidation.startAt,
      endAt: editValidation.endAt,
      clientId,
      clientName: resolvedClientName ?? (clientIdChanged ? undefined : editingEvent.clientName),
      truckPlate,
      containerId,
      notes,
      updatedAt: new Date(),
      updatedBy: props.user.uid,
      updatedByEmail: props.user.email,
    }

    const revisionPayload = {
      eventId: editingEvent.id,
      editedAt: serverTimestamp(),
      editedBy: props.user.uid,
      editedByEmail: props.user.email,
      before: eventToPlain(editingEvent),
      after: eventToPlain(afterEvent),
    }

    try {
      const eventRef = doc(db, 'events', editingEvent.id)
      const revisionRef = doc(db, 'events', editingEvent.id, 'revisions', nowId())
      const batch = writeBatch(db)
      batch.update(eventRef, updateData)
      batch.set(revisionRef, revisionPayload)
      await batch.commit()

      setEvents((prev) => {
        const next = prev.map((e) => (e.id === editingEvent.id ? afterEvent : e))
        next.sort((a, b) => b.startAt.getTime() - a.startAt.getTime())
        return next
      })

      cancelEdit()
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e))
    } finally {
      setEditing(false)
    }
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
      {showUpdateNotice ? (
        <UpdateNoticeModal
          onDismiss={() => {
            persistUpdateNoticeDismissed()
            setShowUpdateNotice(false)
          }}
        />
      ) : null}

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

        <form
          className="tp-card"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="tp-card-header">
            <div style={{ fontWeight: 700 }}>Novo lançamento</div>
            <button type="submit" disabled={validation.errors.length > 0} title={validation.errors.length > 0 ? validation.errors.join(' ') : 'Salvar'}>
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
                  onChange={(e) => {
                    setShiftTouched(false)
                    setDraftPatch({ shiftDate: e.target.value })
                  }}
                  style={{ padding: 10 }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                Turno
                <select
                  value={draft.shift}
                  onChange={(e) => {
                    setShiftTouched(true)
                    setDraftPatch({ shift: e.target.value as Shift })
                  }}
                  style={{ padding: 10 }}
                >
                  <option value="MANHA">Manhã (06:00–15:00)</option>
                  <option value="NOITE">Tarde/Noite (15:00–00:48)</option>
                </select>
              </label>
            </div>

            <div className="tp-grid-2">
              <label style={{ display: 'grid', gap: 6 }}>
                Início (HH:MM)
                <input
                  ref={startInputRef}
                  value={slotsToMaskedHHMM(startSlots)}
                  onKeyDown={(e) => handleMaskedTimeKeyDown('start', e)}
                  onPaste={(e) => handleMaskedTimePaste('start', e)}
                  onFocus={() => handleMaskedTimeFocus('start')}
                  onClick={() => handleMaskedTimeFocus('start')}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label="Início (HH:MM)"
                  style={{ padding: 10, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                Fim (HH:MM)
                <input
                  ref={endInputRef}
                  value={slotsToMaskedHHMM(endSlots)}
                  onKeyDown={(e) => handleMaskedTimeKeyDown('end', e)}
                  onPaste={(e) => handleMaskedTimePaste('end', e)}
                  onFocus={() => handleMaskedTimeFocus('end')}
                  onClick={() => handleMaskedTimeFocus('end')}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label="Fim (HH:MM)"
                  style={{ padding: 10, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
                />
              </label>
            </div>

            <div className="tp-category-grid">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setDraftPatch({ category: c })}
                  className={`tp-category-btn ${draft.category === c ? 'tp-category-btn--active' : ''}`}
                >
                  <div style={{ fontWeight: 700 }}>{c}</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    {c === 'Produtivo'
                      ? 'Exige Cliente + Placa + Container (validação rígida)'
                      : c === 'Em trânsito'
                        ? 'Exige Cliente + Placa (sem container)'
                      : categoriesRequiringNotes.has(c)
                        ? 'Observações obrigatória'
                        : '—'}
                  </div>
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                Cliente (obrigatório)
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

              {draft.category === 'Produtivo' || draft.category === 'Em trânsito' ? (
                <>
                  <label style={{ display: 'grid', gap: 6 }}>
                    Placa (obrigatório em {draft.category})
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

                  {draft.category === 'Produtivo' ? (
                    <>
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
                    </>
                  ) : null}
                </>
              ) : null}
            </div>

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
        </form>

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
                {CATEGORIES.map((c) => (
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
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{ opacity: 0.8 }}>{formatDurationMinutes(e.startAt, e.endAt)}</div>
                      {props.user.role !== 'OPERADOR' ? (
                        <button
                          type="button"
                          onClick={() => startEdit(e)}
                          disabled={Boolean(editingEventId && editingEventId !== e.id) || editing}
                        >
                          {editingEventId === e.id ? 'Editando' : 'Editar'}
                        </button>
                      ) : null}
                    </div>
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
                    ) : e.category === 'Em trânsito' ? (
                      <>
                        <span><b>Cliente:</b> {e.clientName ?? '-'}</span> • <span><b>Placa:</b> {e.truckPlate ?? '-'}</span>
                        {e.notes ? (
                          <>
                            {' '}
                            • <span><b>Obs:</b> {e.notes}</span>
                          </>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <span><b>Cliente:</b> {e.clientName ?? '-'}</span> • <span><b>Obs:</b> {e.notes ?? '-'}</span>
                      </>
                    )}
                  </div>

                  {props.user.role !== 'OPERADOR' ? (
                    <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                      Criado por: {e.createdByEmail ?? e.createdBy}
                    </div>
                  ) : null}

                  {e.updatedAt ? (
                    <div style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>
                      Editado em: {e.updatedAt.toLocaleString()}
                      {e.updatedByEmail ? ` • por ${e.updatedByEmail}` : e.updatedBy ? ` • por ${e.updatedBy}` : ''}
                    </div>
                  ) : null}

                  {editingEventId === e.id && editDraft ? (
                    <form
                      style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--tp-border)' }}
                      onSubmit={(ev) => {
                        ev.preventDefault()
                        void saveEdit()
                      }}
                    >
                      <div className="tp-grid-2">
                        <label style={{ display: 'grid', gap: 6 }}>
                          Bomba
                          <select
                            value={editDraft.pump}
                            onChange={(ev) => setEditDraftPatch({ pump: Number(ev.target.value) as Pump })}
                            style={{ padding: 8 }}
                          >
                            <option value="1">1</option>
                            <option value="2">2</option>
                          </select>
                        </label>

                        <label style={{ display: 'grid', gap: 6 }}>
                          Categoria
                          <select
                            value={editDraft.category}
                            onChange={(ev) => setEditDraftPatch({ category: ev.target.value as ActivityCategory })}
                            style={{ padding: 8 }}
                          >
                            {CATEGORIES.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="tp-grid-2" style={{ marginTop: 8 }}>
                        <label style={{ display: 'grid', gap: 6 }}>
                          Data do turno (dia de início)
                          <input
                            type="date"
                            value={editDraft.shiftDate}
                            onChange={(ev) => setEditDraftPatch({ shiftDate: ev.target.value })}
                            style={{ padding: 8 }}
                          />
                        </label>
                        <label style={{ display: 'grid', gap: 6 }}>
                          Turno
                          <select
                            value={editDraft.shift}
                            onChange={(ev) => setEditDraftPatch({ shift: ev.target.value as Shift })}
                            style={{ padding: 8 }}
                          >
                            <option value="MANHA">Manhã (06:00–15:00)</option>
                            <option value="NOITE">Tarde/Noite (15:00–00:48)</option>
                          </select>
                        </label>
                      </div>

                      <div className="tp-grid-2" style={{ marginTop: 8 }}>
                        <label style={{ display: 'grid', gap: 6 }}>
                          Início (HH:MM)
                          <input
                            ref={editStartInputRef}
                            value={slotsToMaskedHHMM(editStartSlots)}
                            onKeyDown={(ev) => handleEditMaskedTimeKeyDown('start', ev)}
                            onPaste={(ev) => handleEditMaskedTimePaste('start', ev)}
                            onFocus={() => handleEditMaskedTimeFocus('start')}
                            onClick={() => handleEditMaskedTimeFocus('start')}
                            inputMode="numeric"
                            autoComplete="off"
                            aria-label="Início (HH:MM)"
                            style={{ padding: 8, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
                          />
                        </label>
                        <label style={{ display: 'grid', gap: 6 }}>
                          Fim (HH:MM)
                          <input
                            ref={editEndInputRef}
                            value={slotsToMaskedHHMM(editEndSlots)}
                            onKeyDown={(ev) => handleEditMaskedTimeKeyDown('end', ev)}
                            onPaste={(ev) => handleEditMaskedTimePaste('end', ev)}
                            onFocus={() => handleEditMaskedTimeFocus('end')}
                            onClick={() => handleEditMaskedTimeFocus('end')}
                            inputMode="numeric"
                            autoComplete="off"
                            aria-label="Fim (HH:MM)"
                            style={{ padding: 8, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
                          />
                        </label>
                      </div>

                      <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
                        <label style={{ display: 'grid', gap: 6 }}>
                          Cliente (obrigatório)
                          <select
                            value={editDraft.clientId}
                            onChange={(ev) => setEditDraftPatch({ clientId: ev.target.value })}
                            style={{ padding: 8 }}
                          >
                            <option value="">Selecione…</option>
                            {editClientOptions.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                                {!c.active ? ' (inativo)' : ''}
                              </option>
                            ))}
                          </select>
                        </label>

                        {editDraft.category === 'Produtivo' || editDraft.category === 'Em trânsito' ? (
                          <>
                            <label style={{ display: 'grid', gap: 6 }}>
                              Placa (obrigatório em {editDraft.category})
                              <input
                                value={editDraft.truckPlate}
                                onChange={(ev) => setEditDraftPatch({ truckPlate: ev.target.value })}
                                placeholder="ABC1234 ou ABC1D23"
                                style={{ padding: 8 }}
                              />
                            </label>

                            {editDraft.category === 'Produtivo' ? (
                              <label style={{ display: 'grid', gap: 6 }}>
                                Container (obrigatório em Produtivo)
                                <input
                                  value={editDraft.containerId}
                                  onChange={(ev) => setEditDraftPatch({ containerId: ev.target.value })}
                                  placeholder="ABCD 123456-7"
                                  style={{ padding: 8 }}
                                />
                              </label>
                            ) : null}
                          </>
                        ) : null}

                        {categoriesRequiringNotes.has(editDraft.category) ? (
                          <label style={{ display: 'grid', gap: 6 }}>
                            Observações (obrigatória em {editDraft.category})
                            <input
                              value={editDraft.notes}
                              onChange={(ev) => setEditDraftPatch({ notes: ev.target.value })}
                              placeholder="Descreva..."
                              style={{ padding: 8 }}
                            />
                          </label>
                        ) : editDraft.category === 'Produtivo' ? (
                          <label style={{ display: 'grid', gap: 6 }}>
                            Observações (opcional em Produtivo)
                            <input
                              value={editDraft.notes}
                              onChange={(ev) => setEditDraftPatch({ notes: ev.target.value })}
                              placeholder="Ex: Troca de container, ajuste..."
                              style={{ padding: 8 }}
                            />
                          </label>
                        ) : null}
                      </div>

                      {editValidation.errors.length > 0 ? (
                        <div className="tp-panel-danger" style={{ marginTop: 8 }}>
                          <div style={{ fontWeight: 700 }} className="tp-danger-text">
                            Pendências
                          </div>
                          <ul style={{ margin: '8px 0 0 18px' }} className="tp-danger-text">
                            {editValidation.errors.map((err) => (
                              <li key={err}>{err}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {editError ? (
                        <div style={{ marginTop: 8, fontSize: 13, whiteSpace: 'pre-wrap' }} className="tp-danger-text">
                          {editError}
                        </div>
                      ) : null}

                      <div className="tp-actions-row" style={{ marginTop: 10 }}>
                        <button type="submit" disabled={editing || editValidation.errors.length > 0}>
                          {editing ? 'Salvando…' : 'Salvar edição'}
                        </button>
                        <button type="button" onClick={cancelEdit} disabled={editing}>
                          Cancelar
                        </button>
                      </div>
                    </form>
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

function IndicatorsPage(props: { user: User }) {
  const defaultRange = useMemo(() => getPresetRange('WEEK'), [])
  const [rangePreset, setRangePreset] = useState<DateRangePreset>('WEEK')
  const [rangeFrom, setRangeFrom] = useState<string>(defaultRange.from)
  const [rangeTo, setRangeTo] = useState<string>(defaultRange.to)

  const [filterPump, setFilterPump] = useState<'ALL' | Pump>('ALL')
  const [filterShift, setFilterShift] = useState<'ALL' | Shift>('ALL')
  const [filterCategory, setFilterCategory] = useState<'ALL' | ActivityCategory>('ALL')
  const [filterClientId, setFilterClientId] = useState<'ALL' | string>('ALL')

  const [events, setEvents] = useState<StoredEvent[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [eventsError, setEventsError] = useState<string | null>(null)

  const [clients, setClients] = useState<Client[]>([])
  const [loadingClients, setLoadingClients] = useState(false)
  const [clientsError, setClientsError] = useState<string | null>(null)

  const normalizedRange = useMemo(() => {
    if (!rangeFrom || !rangeTo) return null
    if (rangeFrom <= rangeTo) return { from: rangeFrom, to: rangeTo, inverted: false }
    return { from: rangeTo, to: rangeFrom, inverted: true }
  }, [rangeFrom, rangeTo])

  const canView = props.user.role !== 'OPERADOR'

  useEffect(() => {
    if (rangePreset === 'CUSTOM') return
    const preset = getPresetRange(rangePreset)
    setRangeFrom(preset.from)
    setRangeTo(preset.to)
  }, [rangePreset])

  useEffect(() => {
    if (!canView) return
    void (async () => {
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
    })()
  }, [canView])

  async function loadEvents(range: { from: string; to: string }) {
    setEventsError(null)
    setLoadingEvents(true)
    try {
      const base = collection(db, 'events')
      const q = query(
        base,
        where('shiftDate', '>=', range.from),
        where('shiftDate', '<=', range.to),
        orderBy('shiftDate', 'desc'),
        limit(3000),
      )
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
            updatedBy: data.updatedBy as string | undefined,
            updatedByEmail: data.updatedByEmail as string | undefined,
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

      items.sort((a, b) => b.startAt.getTime() - a.startAt.getTime())
      setEvents(items)
    } catch (e) {
      setEventsError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingEvents(false)
    }
  }

  useEffect(() => {
    if (!canView || !normalizedRange) return
    void loadEvents({ from: normalizedRange.from, to: normalizedRange.to })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, normalizedRange?.from, normalizedRange?.to])

  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (filterPump !== 'ALL' && e.pump !== filterPump) return false
      if (filterShift !== 'ALL' && e.shift !== filterShift) return false
      if (filterCategory !== 'ALL' && e.category !== filterCategory) return false
      if (filterClientId !== 'ALL' && e.clientId !== filterClientId) return false
      return true
    })
  }, [events, filterPump, filterShift, filterCategory, filterClientId])

  const totalsByCategory = useMemo(() => {
    const map = new Map<ActivityCategory, { minutes: number; count: number }>()
    CATEGORIES.forEach((c) => map.set(c, { minutes: 0, count: 0 }))
    filteredEvents.forEach((e) => {
      const minutes = Math.max(0, Math.floor((e.endAt.getTime() - e.startAt.getTime()) / 60000))
      const current = map.get(e.category) ?? { minutes: 0, count: 0 }
      current.minutes += minutes
      current.count += 1
      map.set(e.category, current)
    })
    return map
  }, [filteredEvents])

  const totalMinutes = useMemo(() => {
    let total = 0
    filteredEvents.forEach((e) => {
      total += Math.max(0, Math.floor((e.endAt.getTime() - e.startAt.getTime()) / 60000))
    })
    return total
  }, [filteredEvents])

  const productiveMinutes = totalsByCategory.get('Produtivo')?.minutes ?? 0
  const totalEvents = filteredEvents.length
  const avgMinutes = totalEvents > 0 ? totalMinutes / totalEvents : 0
  const productivePercent = totalMinutes > 0 ? (productiveMinutes / totalMinutes) * 100 : 0

  const summaryRows = useMemo(() => {
    return CATEGORIES.map((category) => {
      const data = totalsByCategory.get(category) ?? { minutes: 0, count: 0 }
      const percent = totalMinutes > 0 ? (data.minutes / totalMinutes) * 100 : 0
      return { category, minutes: data.minutes, count: data.count, percent }
    })
  }, [totalsByCategory, totalMinutes])

  const chartData = useMemo(() => {
    type ChartDatum = { date: string } & Partial<Record<ActivityCategory, number>>
    const byDate = new Map<string, ChartDatum>()
    filteredEvents.forEach((e) => {
      const minutes = Math.max(0, Math.floor((e.endAt.getTime() - e.startAt.getTime()) / 60000))
      const key = e.shiftDate
      const entry: ChartDatum = byDate.get(key) ?? { date: key }
      entry[e.category] = (entry[e.category] ?? 0) + minutes
      byDate.set(key, entry)
    })
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
  }, [filteredEvents])

  const [chartWidth, setChartWidth] = useState<number>(0)

  const chartHeight = useMemo(() => {
    const baseHeight = 300
    const itemsPerRow = chartWidth < 640 ? 2 : 4
    const rows = Math.ceil(CATEGORIES.length / itemsPerRow)
    const legendRows = Math.max(1, rows)
    return baseHeight + legendRows * 24
  }, [chartWidth])

  const chartAxis = useMemo(() => {
    if (chartData.length === 0) {
      return { ticks: [0], max: 0 }
    }

    let maxMinutes = 0
    chartData.forEach((row) => {
      let total = 0
      CATEGORIES.forEach((category) => {
        const value = row[category]
        if (typeof value === 'number') total += value
      })
      if (total > maxMinutes) maxMinutes = total
    })

    const maxRounded = Math.ceil(maxMinutes / 60) * 60
    const maxValue = maxRounded <= 0 ? 0 : maxRounded
    const ticks = Array.from({ length: Math.floor(maxValue / 60) + 1 }, (_, idx) => idx * 60)
    return { ticks, max: maxValue }
  }, [chartData])

  const clientOptions = useMemo(() => {
    return [...clients].sort((a, b) => a.name.localeCompare(b.name))
  }, [clients])

  function exportSummaryCsv() {
    const header = ['Categoria', 'Tempo (min)', 'Tempo (h)', '% do total', 'Qtd. eventos']
    const rows = summaryRows.map((row) => {
      return [
        csvEscape(row.category),
        csvEscape(row.minutes),
        csvEscape(formatMinutesAsHM(row.minutes)),
        csvEscape(formatPercent(row.percent)),
        csvEscape(row.count),
      ].join(';')
    })
    const csv = [header.join(';'), ...rows].join('\n')
    const name = `transbordo_indicadores_${normalizedRange?.from ?? 'all'}_${normalizedRange?.to ?? 'all'}.csv`
    downloadCsv(name, csv)
  }

  if (!canView) {
    return (
      <div className="tp-page">
        <h2>Indicadores</h2>
        <p className="tp-muted">Acesso restrito. Somente Supervisor/Admin.</p>
        <AppFooter />
      </div>
    )
  }

  return (
    <div className="tp-page">
      <section className="tp-section">
        <div className="tp-card">
          <div className="tp-card-header">
            <div style={{ fontWeight: 700 }}>Filtros</div>
            <div className="tp-row-wrap">
              <button
                type="button"
                onClick={() => normalizedRange && void loadEvents({ from: normalizedRange.from, to: normalizedRange.to })}
                disabled={!normalizedRange || loadingEvents}
              >
                {loadingEvents ? 'Carregando…' : 'Atualizar'}
              </button>
              <button type="button" onClick={exportSummaryCsv} disabled={summaryRows.length === 0}>
                Exportar CSV
              </button>
            </div>
          </div>

          <div className="tp-grid-3" style={{ marginTop: 10 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              Período
              <select value={rangePreset} onChange={(e) => setRangePreset(e.target.value as DateRangePreset)} style={{ padding: 8 }}>
                <option value="TODAY">Hoje</option>
                <option value="YESTERDAY">Ontem</option>
                <option value="WEEK">Semana atual</option>
                <option value="LAST_WEEK">Semana passada</option>
                <option value="MONTH">Mês atual</option>
                <option value="LAST_MONTH">Mês passado</option>
                <option value="CUSTOM">Personalizado</option>
              </select>
            </label>

            <label style={{ display: 'grid', gap: 6 }}>
              De
              <input
                type="date"
                value={rangeFrom}
                onChange={(e) => {
                  setRangePreset('CUSTOM')
                  setRangeFrom(e.target.value)
                }}
                style={{ padding: 8 }}
              />
            </label>

            <label style={{ display: 'grid', gap: 6 }}>
              Até
              <input
                type="date"
                value={rangeTo}
                onChange={(e) => {
                  setRangePreset('CUSTOM')
                  setRangeTo(e.target.value)
                }}
                style={{ padding: 8 }}
              />
            </label>
          </div>

          <div className="tp-grid-3" style={{ marginTop: 10 }}>
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
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value as 'ALL' | ActivityCategory)}
                style={{ padding: 8 }}
              >
                <option value="ALL">Todas</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="tp-grid-2" style={{ marginTop: 10 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              Cliente
              <select
                value={filterClientId}
                onChange={(e) => setFilterClientId(e.target.value as 'ALL' | string)}
                disabled={loadingClients}
                style={{ padding: 8 }}
              >
                <option value="ALL">Todos</option>
                {clientOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {!c.active ? ' (inativo)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Resumo</span>
              <div className="tp-muted" style={{ fontSize: 13 }}>
                {loadingEvents ? 'Carregando dados…' : `${filteredEvents.length} lançamento(s) no período`}
              </div>
            </div>
          </div>

          {normalizedRange?.inverted ? (
            <div className="tp-panel-danger" style={{ marginTop: 10 }}>
              Intervalo invertido. Usando {normalizedRange.from} → {normalizedRange.to}.
            </div>
          ) : null}

          {eventsError ? (
            <div style={{ marginTop: 10, fontSize: 13, whiteSpace: 'pre-wrap' }} className="tp-danger-text">
              {eventsError}
            </div>
          ) : null}

          {clientsError ? (
            <div style={{ marginTop: 10, fontSize: 13, whiteSpace: 'pre-wrap' }} className="tp-danger-text">
              {clientsError}
            </div>
          ) : null}
        </div>

          <div className="tp-kpi-grid">
          <div className="tp-kpi-card">
            <div className="tp-kpi-label">Tempo Registrado</div>
            <div className="tp-kpi-value">{formatMinutesAsHM(totalMinutes)}</div>
          </div>
          <div className="tp-kpi-card">
            <div className="tp-kpi-label">Tempo produtivo</div>
            <div className="tp-kpi-value">{formatMinutesAsHM(productiveMinutes)}</div>
          </div>
          <div className="tp-kpi-card">
            <div className="tp-kpi-label">% produtivo</div>
            <div className="tp-kpi-value">{formatPercent(productivePercent)}</div>
          </div>
          <div className="tp-kpi-card">
            <div className="tp-kpi-label">Tempo improdutivo</div>
            <div className="tp-kpi-value">{formatMinutesAsHM(totalMinutes - productiveMinutes)}</div>
          </div>
          <div className="tp-kpi-card">
            <div className="tp-kpi-label">Qtd. lançamentos</div>
            <div className="tp-kpi-value">{totalEvents}</div>
          </div>
          <div className="tp-kpi-card">
            <div className="tp-kpi-label">Tempo médio</div>
            <div className="tp-kpi-value">{formatMinutesAsHM(avgMinutes)}</div>
          </div>
        </div>

        <div className="tp-card">
          <div className="tp-card-header">
            <div style={{ fontWeight: 700 }}>Tempo por categoria</div>
            {normalizedRange ? (
              <div className="tp-muted" style={{ fontSize: 12 }}>
                {normalizedRange.from} → {normalizedRange.to}
              </div>
            ) : null}
          </div>

          {chartData.length === 0 ? (
            <div className="tp-muted" style={{ marginTop: 10 }}>
              Sem dados para o período selecionado.
            </div>
          ) : (
            <div className="tp-chart">
              <ResponsiveContainer width="100%" height={chartHeight} onResize={(w) => setChartWidth(w)}>
                <BarChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tickFormatter={formatShortDate} />
                  <YAxis
                    tickFormatter={(value) => formatAxisHours(Number(value))}
                    ticks={chartAxis.ticks}
                    domain={[0, chartAxis.max]}
                    allowDecimals={false}
                    tickMargin={8}
                  />
                  <Tooltip
                    formatter={(value: number) => formatMinutesAsHM(Number(value))}
                    labelFormatter={(label) => `Data: ${label}`}
                  />
                  <Legend verticalAlign="bottom" wrapperStyle={{ paddingTop: 12 }} />
                  {CATEGORIES.map((category) => (
                    <Bar key={category} dataKey={category} stackId="total" fill={CATEGORY_COLORS[category]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="tp-card">
          <div className="tp-card-header">
            <div style={{ fontWeight: 700 }}>Resumo por categoria</div>
          </div>

          {summaryRows.length === 0 ? (
            <div className="tp-muted" style={{ marginTop: 10 }}>
              Sem dados para o período selecionado.
            </div>
          ) : (
            <div className="tp-table-wrap">
              <table className="tp-table">
                <thead>
                  <tr>
                    <th>Categoria</th>
                    <th>Tempo</th>
                    <th>%</th>
                    <th>Eventos</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.map((row) => (
                    <tr key={row.category}>
                      <td>{row.category}</td>
                      <td>{formatMinutesAsHM(row.minutes)}</td>
                      <td>{formatPercent(row.percent)}</td>
                      <td>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <AppFooter />
    </div>
  )
}

export default App
