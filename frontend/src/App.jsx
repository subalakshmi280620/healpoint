import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import PatientPortal from './PatientPortal'
import DoctorPortal from './DoctorPortal'
import api from './api'
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Command,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  Search,
  ShieldCheck,
  Stethoscope,
  Users,
  X,
} from 'lucide-react'
import './App.css'

const SESSION_KEY = 'healpoint.admin.session'
const PAGE_SIZE = 8

const navigation = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'clinics', label: 'Clinics', icon: HeartPulse, roles: ['platform_admin', 'clinic_admin'] },
  { id: 'clinicAdmins', label: 'Clinic Admins', icon: ShieldCheck, roles: ['platform_admin'] },
  { id: 'doctors', label: 'Doctors', icon: Stethoscope },
  { id: 'patients', label: 'Patients', icon: Users },
  { id: 'appointments', label: 'Appointments', icon: CalendarDays },
]

const pageContent = {
  dashboard: { title: 'Overview', subtitle: 'Here’s what’s happening across your care network.' },
  clinics: { title: 'Clinics', subtitle: 'Manage your clinics and keep every location connected.' },
  clinicAdmins: { title: 'Clinic Admins', subtitle: 'Create and manage administrator access for each clinic.' },
  doctors: { title: 'Doctors', subtitle: 'Your care team, all in one place.' },
  patients: { title: 'Patients', subtitle: 'Search and review patients connected to your network.' },
  appointments: { title: 'Appointments', subtitle: 'Stay on top of every scheduled visit.' },
}

const numberFormat = new Intl.NumberFormat('en-US')

function getErrorMessage(error) {
  return error.response?.data?.message || error.message || 'Something went wrong. Please try again.'
}

function getStoredSession() {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    sessionStorage.removeItem(SESSION_KEY)
    return null
  }
}

function formatDate(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-IN', { ...options, timeZone: 'Asia/Kolkata' }).format(date)
}

function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function AdminPortal() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(() => Boolean(getStoredSession()?.token))
  const [authError, setAuthError] = useState('')
  const [page, setPage] = useState('dashboard')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [doctorStatusFilter, setDoctorStatusFilter] = useState('')
  const [doctorSpecialtyFilter, setDoctorSpecialtyFilter] = useState('')
  const [doctorSort, setDoctorSort] = useState('createdAt')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [toast, setToast] = useState('')

  const logout = useCallback(() => {
    const stored = getStoredSession()
    sessionStorage.removeItem(SESSION_KEY)
    setSession(null)
    setPage('dashboard')
    setSearch('')
    setAuthError('')
    if (stored?.token) {
      api.post('/auth/logout/', {}, {
        headers: { Authorization: `Bearer ${stored.token}` },
      }).catch(() => {})
    }
  }, [])

  useEffect(() => {
    const stored = getStoredSession()
    if (!stored?.token) {
      return
    }

    const controller = new AbortController()
    api
      .get('/auth/me/', {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${stored.token}` },
      })
      .then(({ data }) => {
        const user = data.data.user
        if (!['platform_admin', 'clinic_admin'].includes(user.role)) {
          throw new Error('This dashboard is available to administrators only.')
        }
        const next = { token: stored.token, user }
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(next))
        setSession(next)
      })
      .catch((error) => {
        if (!axios.isCancel(error)) {
          sessionStorage.removeItem(SESSION_KEY)
          if (error.message === 'This dashboard is available to administrators only.') {
            setAuthError(error.message)
          }
        }
      })
      .finally(() => setAuthLoading(false))

    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const selectPage = (nextPage) => {
    setPage(nextPage)
    setPageNumber(1)
    setSearch('')
    setStatusFilter('')
    setDoctorStatusFilter('')
    setDoctorSpecialtyFilter('')
    setDoctorSort('createdAt')
    setFromDate('')
    setToDate('')
    setMobileNavOpen(false)
  }

  const onLogin = async (email, password) => {
    setAuthError('')
    try {
      const { data } = await api.post('/auth/login/', { email, password })
      const next = { token: data.data.token, user: data.data.user }
      if (!['platform_admin', 'clinic_admin'].includes(next.user.role)) {
        setAuthError('This dashboard is available to administrators only.')
        return
      }
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(next))
      setSession(next)
    } catch (error) {
      setAuthError(getErrorMessage(error))
    }
  }

  if (authLoading) {
    return <div className="app-loading"><span className="loader" /> Securing your workspace…</div>
  }

  if (!session) {
    return <LoginScreen onLogin={onLogin} error={authError} />
  }

  return (
    <div className="app-shell">
      {mobileNavOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
      <Sidebar
        activePage={page}
        user={session.user}
        open={mobileNavOpen}
        onNavigate={selectPage}
        onLogout={logout}
      />
      <main className="main-panel">
        <Topbar
          page={page}
          search={search}
          onSearch={(value) => {
            setSearch(value)
            setPageNumber(1)
          }}
          user={session.user}
          onMenu={() => setMobileNavOpen(true)}
          onLogout={logout}
          token={session.token}
          onUnauthorized={logout}
          onToast={setToast}
        />
        <div className="content-area">
          <div key={page} className="page-transition">
            <div className="page-heading">
              <div>
                <span className="eyebrow">{session.user.role === 'platform_admin' ? 'PLATFORM ADMIN' : 'CLINIC ADMIN'} WORKSPACE</span>
                <h1>{pageContent[page].title}</h1>
                <p>{pageContent[page].subtitle}</p>
              </div>
              <div className="heading-date"><CalendarDays size={16} /> {formatDate(new Date(), { weekday: 'short', month: 'long', day: 'numeric' })}</div>
            </div>
            <DashboardContent
              page={page}
              userRole={session.user.role}
              token={session.token}
              search={search}
              pageNumber={pageNumber}
              statusFilter={statusFilter}
              doctorStatusFilter={doctorStatusFilter}
              doctorSpecialtyFilter={doctorSpecialtyFilter}
              doctorSort={doctorSort}
              fromDate={fromDate}
              toDate={toDate}
              refreshKey={refreshKey}
              onPageChange={setPageNumber}
              onStatusFilter={setStatusFilter}
              onDoctorStatusFilter={setDoctorStatusFilter}
              onDoctorSpecialtyFilter={setDoctorSpecialtyFilter}
              onDoctorSort={setDoctorSort}
              onFromDate={setFromDate}
              onToDate={setToDate}
              onNavigate={selectPage}
              onRefresh={() => setRefreshKey((key) => key + 1)}
              onToast={setToast}
              onUnauthorized={logout}
            />
          </div>
        </div>
        <footer className="app-footer"><span>© 2025 HealPoint Health Systems</span><span><ShieldCheck size={14} /> Secure care management</span></footer>
      </main>
      {toast && <div className="toast"><span className="toast-check"><Check size={15} /></span>{toast}</div>}
    </div>
  )
}

function LoginScreen({ onLogin, error }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    await onLogin(email, password)
    setSubmitting(false)
  }

  return (
    <div className="login-shell">
      <section className="login-art">
        <div className="login-brand"><span className="brand-mark"><HeartPulse size={23} /></span><span>healpoint</span></div>
        <div className="login-art-copy">
          <span className="eyebrow">BETTER CARE, TOGETHER</span>
          <h1>One connected view of better health.</h1>
          <p>Bring your clinics, care teams, and patient journeys into focus.</p>
        </div>
        <div className="login-image" role="img" aria-label="Healthcare professionals collaborating" />
        <div className="login-art-footer"><ShieldCheck size={15} /> A secure workspace for care teams</div>
      </section>
      <section className="login-form-side">
        <div className="login-form-wrap">
          <span className="mobile-login-brand"><HeartPulse size={22} /> healpoint</span>
          <div className="login-heading">
            <span className="eyebrow">ADMIN PORTAL</span>
            <h2>Welcome back</h2>
            <p>Sign in with your administrator account to continue.</p>
          </div>
          <form onSubmit={submit} className="login-form">
            <label htmlFor="admin-email">Work email</label>
            <input id="admin-email" type="email" autoComplete="username" placeholder="you@clinic.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <div className="password-label"><label htmlFor="admin-password">Password</label></div>
            <input id="admin-password" type="password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            {error && <div className="login-error" role="alert">{error}</div>}
            <button type="submit" className="primary-button login-submit" disabled={submitting}>
              {submitting ? <><span className="button-spinner" /> Signing in…</> : <>Sign in securely <ArrowRight size={17} /></>}
            </button>
          </form>
          <div className="login-secure"><ShieldCheck size={16} /> Your information is protected with secure access.</div>
          <p className="login-help">Need access? Contact your platform administrator.</p>
          <button className="admin-patient-link" onClick={() => {
            window.history.pushState({}, '', '/login')
            window.dispatchEvent(new PopStateEvent('popstate'))
          }}>Looking for patient sign in? <span>Go to patient portal</span></button>
        </div>
      </section>
    </div>
  )
}

function Sidebar({ activePage, user, open, onNavigate, onLogout }) {
  const links = navigation.filter((item) => !item.roles || item.roles.includes(user.role))
  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="sidebar-brand">
        <span className="brand-mark"><HeartPulse size={22} /></span>
        <span className="brand-name">healpoint</span>
        <span className="brand-admin">ADMIN</span>
      </div>
      <div className="workspace-label">WORKSPACE</div>
      <nav className="sidebar-nav" aria-label="Main navigation">
        {links.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`nav-link ${activePage === id ? 'nav-link-active' : ''}`} onClick={() => onNavigate(id)}>
            <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-support">
        <div className="support-icon"><Activity size={18} /></div>
        <strong>Care, in sync.</strong>
        <p>Every connection makes a difference.</p>
      </div>
      <div className="sidebar-profile">
        <div className="avatar avatar-navy">{initials(user.name)}</div>
        <div className="profile-copy"><strong>{user.name}</strong><span>{user.role === 'platform_admin' ? 'Platform admin' : 'Clinic admin'}</span></div>
        <button className="icon-button profile-logout" aria-label="Sign out" title="Sign out" onClick={onLogout}><LogOut size={17} /></button>
      </div>
    </aside>
  )
}

function Topbar({ page, search, onSearch, user, onMenu, onLogout, token, onUnauthorized, onToast }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [notificationError, setNotificationError] = useState('')

  const loadNotifications = useCallback(async (signal) => {
    try {
      const { data } = await api.get('/notifications', {
        signal,
        params: { limit: 8 },
        headers: { Authorization: `Bearer ${token}` },
      })
      setNotifications(data.data.notifications || [])
      setUnreadCount(data.data.unreadCount || 0)
      setNotificationError('')
    } catch (error) {
      if (axios.isCancel(error)) return
      if (error.response?.status === 401) onUnauthorized()
      else setNotificationError(getErrorMessage(error))
    }
  }, [token, onUnauthorized])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => loadNotifications(controller.signal), 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [loadNotifications])

  const markRead = async (notification) => {
    try {
      await api.patch(`/notifications/${notification._id}/read`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setNotifications((items) => items.map((item) =>
        item._id === notification._id ? { ...item, readAt: item.readAt || new Date().toISOString() } : item
      ))
      if (!notification.readAt) setUnreadCount((count) => Math.max(0, count - 1))
    } catch (error) {
      if (error.response?.status === 401) onUnauthorized()
      else onToast(getErrorMessage(error))
    }
  }

  const markAllRead = async () => {
    try {
      await api.patch('/notifications/read-all', {}, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const readAt = new Date().toISOString()
      setNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt || readAt })))
      setUnreadCount(0)
    } catch (error) {
      if (error.response?.status === 401) onUnauthorized()
      else onToast(getErrorMessage(error))
    }
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={onMenu}><Menu size={21} /></button>
        <div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{pageContent[page].title}</strong></div>
      </div>
      <div className="topbar-actions">
        {page !== 'dashboard' && (
          <label className="global-search">
            <Search size={16} />
            <input aria-label={`Search ${page}`} placeholder={`Search ${page.toLowerCase()}…`} value={search} onChange={(event) => onSearch(event.target.value)} />
            <kbd><Command size={11} /> K</kbd>
          </label>
        )}
        <button className="icon-button notification-button" aria-label={`${unreadCount} unread notifications`} aria-expanded={notificationsOpen} onClick={() => { const opening = !notificationsOpen; setNotificationsOpen(opening); if (opening) loadNotifications() }}><Bell size={18} />{unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}</button>
        {notificationsOpen && <div className="notification-panel">
          <div className="notification-panel-head"><div><strong>Notifications</strong><span>{unreadCount} unread</span></div><button disabled={!unreadCount} onClick={markAllRead}>Mark all read</button></div>
          {notificationError ? <div className="notification-panel-state" role="alert">{notificationError}<button onClick={() => loadNotifications()}>Retry</button></div> : notifications.length ? <div className="notification-list">{notifications.map((notification) => <button key={notification._id} className={`notification-item ${notification.readAt ? '' : 'notification-unread'}`} onClick={() => !notification.readAt && markRead(notification)}><span className={`notification-type-icon notification-type-${notification.type}`}><CalendarDays size={15} /></span><span className="notification-copy"><strong>{notification.title}</strong><span>{notification.message}</span><small>{formatDate(notification.createdAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small></span>{!notification.readAt && <i aria-label="Unread" />}</button>)}</div> : <div className="notification-panel-state">You’re all caught up.</div>}
        </div>}
        <div className="topbar-divider" />
        <button className="topbar-user" onClick={() => setMenuOpen((value) => !value)}>
          <div className="avatar avatar-cyan">{initials(user.name)}</div>
          <span>{user.name}</span><ChevronDown size={15} />
        </button>
        {menuOpen && <div className="user-menu"><div className="user-menu-name">{user.name}</div><div className="user-menu-role">{user.role === 'platform_admin' ? 'Platform admin' : 'Clinic admin'}</div><button onClick={onLogout}><LogOut size={15} /> Sign out</button></div>}
      </div>
    </header>
  )
}

function DashboardContent({
  page, userRole, token, search, pageNumber, statusFilter, fromDate, toDate, refreshKey,
  doctorStatusFilter, doctorSpecialtyFilter, doctorSort,
  onPageChange, onStatusFilter, onFromDate, onToDate, onNavigate, onRefresh, onToast, onUnauthorized,
  onDoctorStatusFilter, onDoctorSpecialtyFilter, onDoctorSort,
}) {
  const [stats, setStats] = useState(null)
  const [dashboardAppointments, setDashboardAppointments] = useState([])
  const [rows, setRows] = useState([])
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [doctorOptions, setDoctorOptions] = useState({ candidates: [], specialties: [], clinics: [] })
  const [clinicAdminClinics, setClinicAdminClinics] = useState([])
  const [doctorEditor, setDoctorEditor] = useState(null)
  const [clinicEditor, setClinicEditor] = useState(null)
  const [clinicAdminEditorOpen, setClinicAdminEditorOpen] = useState(false)

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(pageNumber), limit: String(PAGE_SIZE) })
    if (search.trim() && ['clinics', 'clinicAdmins', 'doctors', 'patients'].includes(page)) params.set('search', search.trim())
    if (page === 'patients') params.set('role', 'patient')
    if (page === 'doctors') {
      if (doctorStatusFilter) params.set('status', doctorStatusFilter)
      if (doctorSpecialtyFilter) params.set('specialty', doctorSpecialtyFilter)
      params.set('sortBy', doctorSort === 'fee' || doctorSort === 'experience' ? doctorSort : 'createdAt')
      params.set('order', 'desc')
    }
    if (page === 'appointments') {
      if (statusFilter) params.set('status', statusFilter)
      if (fromDate) params.set('from', new Date(`${fromDate}T00:00:00+05:30`).toISOString())
      if (toDate) params.set('to', new Date(`${toDate}T23:59:59+05:30`).toISOString())
    }
    return params.toString()
  }, [page, pageNumber, search, statusFilter, fromDate, toDate, doctorStatusFilter, doctorSpecialtyFilter, doctorSort])

  const loadData = useCallback(async (signal) => {
    setLoading(true)
    setError('')
    const config = { signal, headers: { Authorization: `Bearer ${token}` } }

    try {
      if (page === 'dashboard') {
        const [statsResponse, appointmentsResponse] = await Promise.all([
          api.get('/admin/dashboard/stats', config),
          api.get('/admin/appointments', { ...config, params: { page: 1, limit: 5 } }),
        ])
        setStats(statsResponse.data.data)
        setDashboardAppointments(appointmentsResponse.data.data.appointments)
        setRows([])
      } else {
        const endpoint = {
          clinics: '/admin/clinics',
          clinicAdmins: '/admin/clinic-admins',
          doctors: '/admin/doctors',
          patients: '/admin/users',
          appointments: '/admin/appointments',
        }[page]
        const responses = page === 'doctors'
          ? await Promise.all([
              api.get(`${endpoint}?${queryString}`, config),
              api.get('/admin/doctor-candidates', { ...config, params: { page: 1, limit: 100 } }),
              api.get('/admin/specialties', config),
              api.get('/admin/clinics', { ...config, params: { page: 1, limit: 100 } }),
            ])
          : page === 'clinicAdmins'
            ? await Promise.all([
                api.get(`${endpoint}?${queryString}`, config),
                api.get('/admin/clinics', { ...config, params: { page: 1, limit: 100 } }),
              ])
          : [await api.get(`${endpoint}?${queryString}`, config)]
        const { data } = responses[0]
        const dataKey = { clinics: 'clinics', clinicAdmins: 'clinicAdmins', doctors: 'doctors', patients: 'users', appointments: 'appointments' }[page]
        setRows(data.data[dataKey] || [])
        setPagination(data.pagination || { page: 1, limit: PAGE_SIZE, total: 0, pages: 1 })
        if (page === 'doctors') {
          setDoctorOptions({
            candidates: responses[1].data.data.users || [],
            specialties: responses[2].data.data.specialties || [],
            clinics: responses[3].data.data.clinics || [],
          })
        } else if (page === 'clinicAdmins') {
          setClinicAdminClinics(responses[1].data.data.clinics || [])
        }
      }
    } catch (requestError) {
      if (axios.isCancel(requestError)) return
      if (requestError.response?.status === 401) {
        onUnauthorized()
        return
      }
      setError(getErrorMessage(requestError))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [page, queryString, token, onUnauthorized])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => loadData(controller.signal), 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [loadData, refreshKey])

  if (page === 'dashboard') {
    return <Overview stats={stats} appointments={dashboardAppointments} loading={loading} error={error} onRetry={() => onRefresh()} onNavigate={onNavigate} />
  }

  const visibleRows = rows
  const changeStatus = async (appointment) => {
    if (!window.confirm('Cancel this confirmed appointment?')) return
    try {
      await api.patch(`/admin/appointments/${appointment._id}/status`, { status: 'cancelled' }, {
        headers: { Authorization: `Bearer ${token}` },
      })
      onToast('Appointment cancelled successfully')
      onRefresh()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    }
  }

  const changeClinicAdminStatus = async (clinicAdmin) => {
    const nextStatus = !clinicAdmin.isActive
    const action = nextStatus ? 'activate' : 'deactivate'
    if (!window.confirm(`Are you sure you want to ${action} ${clinicAdmin.name}'s Clinic Admin account?`)) return
    try {
      await api.patch(`/admin/clinic-admins/${clinicAdmin._id}/status`, { isActive: nextStatus }, {
        headers: { Authorization: `Bearer ${token}` },
      })
      onToast(`Clinic Admin account ${nextStatus ? 'activated' : 'deactivated'} successfully`)
      onRefresh()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    }
  }

  const changeUserStatus = async (user) => {
    const nextStatus = !user.isActive
    const action = nextStatus ? 'activate' : 'deactivate'
    if (!window.confirm(`Are you sure you want to ${action} ${user.name}'s account?`)) return
    try {
      await api.patch(`/admin/users/${user._id}/status`, { isActive: nextStatus }, {
        headers: { Authorization: `Bearer ${token}` },
      })
      onToast(`Account ${nextStatus ? 'activated' : 'deactivated'} successfully`)
      onRefresh()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    }
  }

  return (
    <section className="data-section">
      {page === 'appointments' && (
        <div className="filter-toolbar">
          <label className="filter-select"><span>Status</span><select value={statusFilter} onChange={(event) => { onStatusFilter(event.target.value); onPageChange(1) }}><option value="">All statuses</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option><option value="completed">Completed</option></select><ChevronDown size={14} /></label>
          <label className="date-filter"><span>From</span><input type="date" value={fromDate} onChange={(event) => { onFromDate(event.target.value); onPageChange(1) }} /></label>
          <label className="date-filter"><span>To</span><input type="date" value={toDate} onChange={(event) => { onToDate(event.target.value); onPageChange(1) }} /></label>
          <button className="filter-reset" onClick={() => { onStatusFilter(''); onFromDate(''); onToDate(''); onPageChange(1) }}>Reset filters</button>
        </div>
      )}
      {page === 'doctors' && (
        <div className="filter-toolbar">
          <label className="filter-select"><span>Status</span><select value={doctorStatusFilter} onChange={(event) => { onDoctorStatusFilter(event.target.value); onPageChange(1) }}><option value="">All doctors</option><option value="active">Active</option><option value="inactive">Inactive</option></select><ChevronDown size={14} /></label>
          <label className="filter-select"><span>Specialty</span><select value={doctorSpecialtyFilter} onChange={(event) => { onDoctorSpecialtyFilter(event.target.value); onPageChange(1) }}><option value="">All specialties</option>{doctorOptions.specialties.map((specialty) => <option value={specialty._id} key={specialty._id}>{specialty.name}</option>)}</select><ChevronDown size={14} /></label>
          <label className="filter-select"><span>Sort by</span><select value={doctorSort} onChange={(event) => { onDoctorSort(event.target.value); onPageChange(1) }}><option value="createdAt">Recently added</option><option value="experience">Experience</option><option value="fee">Consultation fee</option></select><ChevronDown size={14} /></label>
        </div>
      )}
      <div className="table-card">
        <div className="table-card-head">
          <div><h2>{pageContent[page].title} directory</h2><p>{loading ? 'Updating records…' : `${numberFormat.format(pagination.total)} records`}</p></div>
          <div className="table-head-actions">
            {page === 'clinics' && <button className="primary-small-button" onClick={() => setClinicEditor({ clinic: null })}><HeartPulse size={14} /> Add clinic</button>}
            {page === 'clinicAdmins' && userRole === 'platform_admin' && <button className="primary-small-button" onClick={() => setClinicAdminEditorOpen(true)}><ShieldCheck size={14} /> Add Clinic Admin</button>}
            {page === 'doctors' && <button className="primary-small-button" onClick={() => setDoctorEditor({ doctor: null })}><Stethoscope size={14} /> Add doctor</button>}
            <button className="subtle-button" onClick={() => onRefresh()}><Activity size={15} /> Refresh</button>
          </div>
        </div>
        {error ? <ErrorState message={error} onRetry={() => onRefresh()} /> : loading ? <TableSkeleton /> : visibleRows.length === 0 ? <EmptyState page={page} searching={Boolean(search || statusFilter || fromDate || toDate)} /> : (
          page === 'clinicAdmins'
            ? <ClinicAdminTable rows={visibleRows} onToggleStatus={changeClinicAdminStatus} />
            : <DataTable page={page} rows={visibleRows} onAppointmentCancel={changeStatus} onEditDoctor={(doctor) => setDoctorEditor({ doctor })} onEditClinic={(clinic) => setClinicEditor({ clinic })} onToggleUserStatus={['patients', 'doctors'].includes(page) && userRole === 'platform_admin' ? changeUserStatus : null} />
        )}
        {!error && !loading && visibleRows.length > 0 && (
          <Pagination pagination={pagination} onPageChange={onPageChange} />
        )}
      </div>
      {doctorEditor && <DoctorEditor
        token={token}
        doctor={doctorEditor.doctor}
        candidates={doctorOptions.candidates}
        specialties={doctorOptions.specialties}
        clinics={doctorOptions.clinics}
        onClose={() => setDoctorEditor(null)}
        onSaved={() => {
          setDoctorEditor(null)
          onToast('Doctor profile saved')
          onRefresh()
        }}
      />}
      {clinicAdminEditorOpen && <ClinicAdminEditor
        token={token}
        clinics={clinicAdminClinics}
        onClose={() => setClinicAdminEditorOpen(false)}
        onCreated={() => {
          setClinicAdminEditorOpen(false)
          onToast('Clinic Admin account created')
          onRefresh()
        }}
      />}
      {clinicEditor && <ClinicEditor
        token={token}
        clinic={clinicEditor.clinic}
        onClose={() => setClinicEditor(null)}
        onSaved={() => {
          setClinicEditor(null)
          onToast('Clinic details saved')
          onRefresh()
        }}
      />}
    </section>
  )
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const coordinatesToForm = (location) => ({
  latitude: location?.type === 'Point' ? String(location.coordinates?.[1] ?? '') : '',
  longitude: location?.type === 'Point' ? String(location.coordinates?.[0] ?? '') : '',
})

const pointFromCoordinates = (latitude, longitude) => {
  if (latitude === '' && longitude === '') return null
  return {
    type: 'Point',
    coordinates: [Number(longitude), Number(latitude)],
  }
}

const emptyClinicForm = {
  name: '',
  description: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  pincode: '',
  latitude: '',
  longitude: '',
  logo: '',
  isActive: true,
  branches: [],
}

const formFromClinic = (clinic) => ({
  ...emptyClinicForm,
  ...Object.fromEntries(
    ['name', 'description', 'email', 'phone', 'address', 'city', 'state', 'pincode', 'logo', 'isActive']
      .map((field) => [field, clinic?.[field] ?? emptyClinicForm[field]])
  ),
  ...coordinatesToForm(clinic?.location),
  branches: (clinic?.branches || []).map((branch) => ({
    ...branch,
    ...coordinatesToForm(branch.location),
  })),
})

function ClinicEditor({ token, clinic, onClose, onSaved }) {
  const [form, setForm] = useState(() => formFromClinic(clinic))
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const update = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setForm((current) => ({ ...current, [field]: value }))
  }

  const updateBranch = (index, field, value) => {
    setForm((current) => ({
      ...current,
      branches: current.branches.map((branch, branchIndex) =>
        branchIndex === index ? { ...branch, [field]: value } : branch
      ),
    }))
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      pincode: form.pincode.trim(),
      location: pointFromCoordinates(form.latitude, form.longitude),
      logo: form.logo.trim(),
      ...(clinic ? { isActive: form.isActive } : {}),
      branches: form.branches.map((branch) => ({
        ...(branch.id ? { id: branch.id } : {}),
        name: branch.name.trim(),
        address: branch.address.trim(),
        city: branch.city.trim(),
        state: branch.state.trim(),
        pincode: branch.pincode.trim(),
        location: pointFromCoordinates(branch.latitude || '', branch.longitude || ''),
        phone: branch.phone?.trim() || '',
        isActive: branch.isActive !== false,
      })),
    }
    try {
      const config = { headers: { Authorization: `Bearer ${token}` } }
      if (clinic) await api.put(`/clinics/${clinic.id}`, payload, config)
      else await api.post('/clinics/', payload, config)
      onSaved()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="editor-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="doctor-editor clinic-editor" role="dialog" aria-modal="true" aria-labelledby="clinic-editor-title">
        <header className="doctor-editor-header"><div><span className="eyebrow">CLINIC DETAILS</span><h2 id="clinic-editor-title">{clinic ? 'Edit clinic' : 'Add clinic'}</h2><p>Keep contact information, locations and active status current.</p></div><button className="icon-button" aria-label="Close clinic editor" onClick={onClose}><X size={18} /></button></header>
        <form className="doctor-editor-form" onSubmit={submit}>
          <div className="doctor-form-grid">
            <label>Clinic name<input value={form.name} onChange={update('name')} required /></label>
            <label>Contact email<input type="email" value={form.email} onChange={update('email')} required /></label>
            <label>Phone<input value={form.phone} onChange={update('phone')} required /></label>
            <label>Logo URL<input type="url" value={form.logo} onChange={update('logo')} /></label>
            <label className="doctor-bio-field">Address<input value={form.address} onChange={update('address')} required /></label>
            <label>City<input value={form.city} onChange={update('city')} required /></label>
            <label>State<input value={form.state} onChange={update('state')} required /></label>
            <label>Postal code<input value={form.pincode} onChange={update('pincode')} required /></label>
            <label>Latitude<input type="number" min="-90" max="90" step="any" value={form.latitude} onChange={update('latitude')} required={form.longitude !== ''} /></label>
            <label>Longitude<input type="number" min="-180" max="180" step="any" value={form.longitude} onChange={update('longitude')} required={form.latitude !== ''} /></label>
            <label className="doctor-bio-field">Description<textarea value={form.description} onChange={update('description')} maxLength={2000} rows={3} /></label>
          </div>
          <section className="clinic-branches-editor">
            <div className="clinic-branches-heading"><div><strong>Branches</strong><span>Changes are saved to this clinic only.</span></div><button type="button" className="subtle-button" onClick={() => setForm((current) => ({ ...current, branches: [...current.branches, { name: '', address: '', city: '', state: '', pincode: '', latitude: '', longitude: '', phone: '', isActive: true }] }))}>Add branch</button></div>
            {form.branches.map((branch, index) => <fieldset className="clinic-branch-form" key={branch.id || `new-${index}`}>
              <legend>{branch.name || `New branch ${index + 1}`}</legend>
              <div className="doctor-form-grid">
                <label>Branch name<input value={branch.name} onChange={(event) => updateBranch(index, 'name', event.target.value)} required /></label>
                <label>Phone<input value={branch.phone || ''} onChange={(event) => updateBranch(index, 'phone', event.target.value)} /></label>
                <label className="doctor-bio-field">Address<input value={branch.address} onChange={(event) => updateBranch(index, 'address', event.target.value)} required /></label>
                <label>City<input value={branch.city} onChange={(event) => updateBranch(index, 'city', event.target.value)} required /></label>
                <label>State<input value={branch.state} onChange={(event) => updateBranch(index, 'state', event.target.value)} required /></label>
                <label>Postal code<input value={branch.pincode} onChange={(event) => updateBranch(index, 'pincode', event.target.value)} required /></label>
                <label>Latitude<input type="number" min="-90" max="90" step="any" value={branch.latitude || ''} onChange={(event) => updateBranch(index, 'latitude', event.target.value)} required={branch.longitude !== ''} /></label>
                <label>Longitude<input type="number" min="-180" max="180" step="any" value={branch.longitude || ''} onChange={(event) => updateBranch(index, 'longitude', event.target.value)} required={branch.latitude !== ''} /></label>
              </div>
              <label className="clinic-branch-active"><input type="checkbox" checked={branch.isActive !== false} onChange={(event) => updateBranch(index, 'isActive', event.target.checked)} /> Branch active</label>
            </fieldset>)}
          </section>
          {clinic && <div className="doctor-editor-toggles"><label><input type="checkbox" checked={form.isActive} onChange={update('isActive')} /> Clinic active</label></div>}
          {error && <div className="login-error" role="alert">{error}</div>}
          <footer className="doctor-editor-footer"><button type="button" className="subtle-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-small-button" disabled={submitting}>{submitting ? 'Saving…' : clinic ? 'Save changes' : 'Create clinic'}</button></footer>
        </form>
      </section>
    </div>
  )
}

const emptyDoctorForm = (clinicId = '') => ({
  userId: '',
  name: '',
  profileImage: '',
  specialty: '',
  qualification: '',
  experienceYears: '0',
  consultationFeeInr: '',
  consultationDurationMinutes: '30',
  languagesSpoken: '',
  bio: '',
  clinicId,
  branchId: '',
  weeklySchedule: [],
  isActive: true,
  clinicAssociationIsActive: true,
})

const formFromDoctor = (doctor, clinicId = '') => {
  const association = doctor?.clinicAssociations?.find((item) =>
    String(item.clinic?._id || item.clinic?.id || item.clinic) ===
    String(clinicId || item.clinic?._id || item.clinic?.id || item.clinic)
  ) || doctor?.clinicAssociations?.[0]
  return {
    ...emptyDoctorForm(clinicId || String(association?.clinic?._id || association?.clinic?.id || '')),
    userId: String(doctor?.user?._id || doctor?.user || ''),
    name: doctor?.user?.name || '',
    profileImage: doctor?.profileImage || '',
    specialty: String(doctor?.specialty?._id || doctor?.specialty || ''),
    qualification: doctor?.qualification || '',
    experienceYears: String(doctor?.experienceYears ?? 0),
    consultationFeeInr: String(doctor?.consultationFeeInr ?? doctor?.consultationFee ?? ''),
    consultationDurationMinutes: String(doctor?.consultationDurationMinutes || 30),
    languagesSpoken: (doctor?.languagesSpoken || []).join(', '),
    bio: doctor?.bio || '',
    branchId: String(association?.branch?._id || association?.branch?.id || ''),
    weeklySchedule: (association?.weeklySchedule || []).map((window) => ({ ...window })),
    isActive: doctor?.isActive ?? true,
    clinicAssociationIsActive: association?.isActive ?? true,
  }
}

function DoctorEditor({ token, doctor, candidates, specialties, clinics, onClose, onSaved }) {
  const [form, setForm] = useState(() => formFromDoctor(doctor, clinics[0]?.id || ''))
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [creatingAccount, setCreatingAccount] = useState(false)
  const [accountSubmitting, setAccountSubmitting] = useState(false)
  const [accountMessage, setAccountMessage] = useState('')
  const [createdCandidates, setCreatedCandidates] = useState([])
  const [accountForm, setAccountForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
  })
  const candidateOptions = [
    ...candidates,
    ...createdCandidates.filter((created) =>
      !candidates.some((candidate) => String(candidate._id) === String(created._id))
    ),
  ]
  const clinic = clinics.find((item) => String(item.id) === String(form.clinicId))
  const branches = clinic?.branches?.filter((branch) => branch.isActive) || []

  const update = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setForm((current) => ({ ...current, [field]: value }))
  }

  const selectClinic = (event) => {
    const clinicId = event.target.value
    const association = doctor?.clinicAssociations?.find((item) =>
      String(item.clinic?._id || item.clinic?.id || item.clinic) === String(clinicId)
    )
    setForm((current) => ({
      ...current,
      clinicId,
      branchId: String(association?.branch?._id || association?.branch?.id || ''),
      weeklySchedule: (association?.weeklySchedule || []).map((window) => ({ ...window })),
      clinicAssociationIsActive: association?.isActive ?? true,
    }))
  }

  const selectUser = (event) => {
    const userId = event.target.value
    const candidate = candidateOptions.find((item) => String(item._id) === userId)
    if (!candidate) {
      setForm((current) => ({ ...current, userId }))
      return
    }
    setForm({
      ...formFromDoctor(candidate.doctorProfile, form.clinicId || clinics[0]?.id || ''),
      userId,
      name: candidate.name,
    })
  }

  const createDoctorAccount = async () => {
    setError('')
    setAccountMessage('')
    if (!form.clinicId || !clinic?.isActive) {
      setError('Choose an active clinic before creating a doctor account.')
      return
    }
    if (accountForm.name.trim().length < 2 || accountForm.name.trim().length > 100) {
      setError('Doctor name must be between 2 and 100 characters.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountForm.email.trim())) {
      setError('Enter a valid email address.')
      return
    }
    if (Array.from(accountForm.password).length < 12) {
      setError('Password must be at least 12 characters.')
      return
    }
    if (new TextEncoder().encode(accountForm.password).length > 72) {
      setError('Password must not exceed 72 UTF-8 bytes.')
      return
    }
    if (accountForm.password !== accountForm.confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setAccountSubmitting(true)
    try {
      const response = await api.post('/admin/doctor-accounts', {
        name: accountForm.name.trim(),
        email: accountForm.email.trim(),
        phone: accountForm.phone.trim(),
        password: accountForm.password,
        clinicId: form.clinicId,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const user = response.data.data.user
      const candidate = { ...user, _id: String(user.id), doctorProfile: null }
      setCreatedCandidates((current) => [...current, candidate])
      setForm((current) => ({ ...current, userId: candidate._id, name: candidate.name }))
      setAccountForm({ name: '', email: '', phone: '', password: '', confirmPassword: '' })
      setCreatingAccount(false)
      setAccountMessage('Account created. Complete the doctor profile and clinic assignment below.')
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setAccountSubmitting(false)
    }
  }

  const setScheduleWindow = (dayOfWeek, index, field, value) => {
    setForm((current) => {
      const dayWindows = current.weeklySchedule
        .filter((window) => window.dayOfWeek === dayOfWeek)
        .map((window) => ({ ...window }))
      dayWindows[index] = { ...dayWindows[index], [field]: value }
      const otherWindows = current.weeklySchedule.filter((window) => window.dayOfWeek !== dayOfWeek)
      return {
        ...current,
        weeklySchedule: [...otherWindows, ...dayWindows].sort((a, b) =>
          a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime)
        ),
      }
    })
  }

  const addScheduleWindow = (dayOfWeek) => {
    setForm((current) => {
      const currentDay = current.weeklySchedule
        .filter((window) => window.dayOfWeek === dayOfWeek)
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
      const previousEnd = currentDay[currentDay.length - 1]?.endTime
      let startTime = previousEnd || '09:00'
      let startMinutes = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3))
      if (startMinutes >= 21 * 60) {
        startTime = '09:00'
        startMinutes = 9 * 60
      }
      const endMinutes = Math.min(startMinutes + 180, 23 * 60 + 45)
      const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`
      return {
        ...current,
        weeklySchedule: [
          ...current.weeklySchedule,
          { dayOfWeek, startTime, endTime },
        ].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime)),
      }
    })
  }

  const removeScheduleWindow = (dayOfWeek, index) => {
    setForm((current) => {
      const dayWindows = current.weeklySchedule.filter((window) => window.dayOfWeek === dayOfWeek)
      dayWindows.splice(index, 1)
      return {
        ...current,
        weeklySchedule: [
          ...current.weeklySchedule.filter((window) => window.dayOfWeek !== dayOfWeek),
          ...dayWindows,
        ],
      }
    })
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    if (!doctor && !form.userId) {
      setError('Choose an active doctor account.')
      return
    }
    if (!form.clinicId) {
      setError('Choose a clinic for this doctor.')
      return
    }
    setSubmitting(true)
    const selectedCandidate = candidates.find((candidate) => String(candidate._id) === String(form.userId))
    const existingProfile = doctor || selectedCandidate?.doctorProfile
    const payload = {
      name: form.name.trim(),
      profileImage: form.profileImage.trim(),
      specialty: form.specialty,
      qualification: form.qualification.trim(),
      experienceYears: Number(form.experienceYears),
      consultationFeeInr: Number(form.consultationFeeInr),
      consultationDurationMinutes: Number(form.consultationDurationMinutes),
      languagesSpoken: form.languagesSpoken.split(',').map((language) => language.trim()).filter(Boolean),
      bio: form.bio.trim(),
      isActive: form.isActive,
      clinicId: form.clinicId,
      branchId: form.branchId,
      weeklySchedule: form.weeklySchedule,
      clinicAssociationIsActive: form.clinicAssociationIsActive,
    }
    if (!existingProfile) payload.user = form.userId
    try {
      const config = { headers: { Authorization: `Bearer ${token}` } }
      if (existingProfile) await api.put(`/doctors/${existingProfile._id}`, payload, config)
      else await api.post('/doctors/', payload, config)
      onSaved()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="editor-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="doctor-editor" role="dialog" aria-modal="true" aria-labelledby="doctor-editor-title">
        <header className="doctor-editor-header"><div><span className="eyebrow">DOCTOR PROFILE</span><h2 id="doctor-editor-title">{doctor ? 'Edit doctor' : 'Add doctor'}</h2><p>Profile, clinic assignment and India Standard Time schedule.</p></div><button className="icon-button" aria-label="Close doctor editor" onClick={onClose}><X size={18} /></button></header>
        <form className="doctor-editor-form" onSubmit={submit}>
          <div className="doctor-form-grid">
            {!doctor && <label>Doctor account<select value={form.userId} onChange={selectUser} required><option value="">Choose account</option>{candidateOptions.map((candidate) => <option value={candidate._id} key={candidate._id}>{candidate.name} · {candidate.email}{candidate.doctorProfile ? ' · existing profile' : ''}</option>)}</select></label>}
            <label>Full name<input value={form.name} onChange={update('name')} required minLength={2} maxLength={100} /></label>
            <label>Specialization<select value={form.specialty} onChange={update('specialty')} required><option value="">Choose specialty</option>{specialties.map((specialty) => <option value={specialty._id} key={specialty._id}>{specialty.name}</option>)}</select></label>
            <label>Qualification<input value={form.qualification} onChange={update('qualification')} required maxLength={200} placeholder="MBBS, MD" /></label>
            <label>Experience (years)<input type="number" min="0" max="80" step="1" value={form.experienceYears} onChange={update('experienceYears')} required /></label>
            <label>Consultation fee (₹)<input type="number" min="0" step="1" value={form.consultationFeeInr} onChange={update('consultationFeeInr')} required /></label>
            <label>Consultation duration<select value={form.consultationDurationMinutes} onChange={update('consultationDurationMinutes')} required>{[15, 30, 45, 60, 75, 90, 120, 150, 180, 210, 240].map((minutes) => <option value={minutes} key={minutes}>{minutes} minutes</option>)}</select></label>
            <label>Profile photo URL<input type="url" value={form.profileImage} onChange={update('profileImage')} placeholder="https://…" /></label>
            <label>Languages spoken<input value={form.languagesSpoken} onChange={update('languagesSpoken')} placeholder="English, Hindi" /></label>
            <label>Clinic<select value={form.clinicId} onChange={selectClinic} required><option value="">Choose clinic</option>{clinics.filter((item) => item.isActive).map((item) => <option value={item.id} key={item.id}>{item.name} · {item.city}</option>)}</select></label>
            <label>Branch<select value={form.branchId} onChange={update('branchId')}><option value="">Main clinic</option>{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name} · {branch.city}</option>)}</select></label>
            <label className="doctor-bio-field">About the doctor<textarea value={form.bio} onChange={update('bio')} maxLength={3000} rows={3} /></label>
          </div>
          {!doctor && <section className="clinic-branches-editor doctor-account-creation">
            <div className="clinic-branches-heading"><div><strong>Doctor account</strong><span>Create a doctor login without enabling public doctor registration.</span></div><button type="button" className="subtle-button" onClick={() => { setCreatingAccount((current) => !current); setError('') }}>{creatingAccount ? 'Use existing account' : 'Create new account'}</button></div>
            {creatingAccount && <div className="doctor-form-grid">
              <label>Account name<input autoComplete="name" value={accountForm.name} onChange={(event) => setAccountForm((current) => ({ ...current, name: event.target.value }))} maxLength={100} /></label>
              <label>Email<input type="email" autoComplete="email" value={accountForm.email} onChange={(event) => setAccountForm((current) => ({ ...current, email: event.target.value }))} /></label>
              <label>Phone<input autoComplete="tel" value={accountForm.phone} onChange={(event) => setAccountForm((current) => ({ ...current, phone: event.target.value }))} maxLength={30} /></label>
              <label>Initial password<input type="password" autoComplete="new-password" value={accountForm.password} onChange={(event) => setAccountForm((current) => ({ ...current, password: event.target.value }))} minLength={12} /></label>
              <label>Confirm password<input type="password" autoComplete="new-password" value={accountForm.confirmPassword} onChange={(event) => setAccountForm((current) => ({ ...current, confirmPassword: event.target.value }))} minLength={12} /></label>
              <div className="doctor-bio-field"><button type="button" className="primary-small-button" onClick={createDoctorAccount} disabled={accountSubmitting}>{accountSubmitting ? 'Creating account…' : 'Create doctor account'}</button></div>
            </div>}
            {accountMessage && <div className="doctor-account-message" role="status">{accountMessage}</div>}
          </section>}
          <fieldset className="schedule-editor"><legend>Weekly visiting hours · India Standard Time</legend>{WEEKDAYS.map((day, dayOfWeek) => {
            const windows = form.weeklySchedule.filter((item) => item.dayOfWeek === dayOfWeek)
            return <div className="schedule-day-row" key={day}><label><input type="checkbox" checked={windows.length > 0} onChange={(event) => {
              if (event.target.checked) addScheduleWindow(dayOfWeek)
              else setForm((current) => ({ ...current, weeklySchedule: current.weeklySchedule.filter((item) => item.dayOfWeek !== dayOfWeek) }))
            }} />{day}</label><div className="schedule-windows">{windows.map((window, index) => <div className="schedule-window" key={`${day}-${index}`}><input aria-label={`${day} window ${index + 1} start time`} type="time" step="900" value={window.startTime} onChange={(event) => setScheduleWindow(dayOfWeek, index, 'startTime', event.target.value)} /><span>to</span><input aria-label={`${day} window ${index + 1} end time`} type="time" step="900" value={window.endTime} onChange={(event) => setScheduleWindow(dayOfWeek, index, 'endTime', event.target.value)} /><button type="button" aria-label={`Remove ${day} hours window ${index + 1}`} onClick={() => removeScheduleWindow(dayOfWeek, index)}><X size={12} /></button></div>)}{windows.length > 0 && <button type="button" className="add-schedule-window" disabled={windows[windows.length - 1].endTime >= '23:45'} onClick={() => addScheduleWindow(dayOfWeek)}>Add hours</button>}</div></div>
          })}</fieldset>
          <div className="doctor-editor-toggles"><label><input type="checkbox" checked={form.isActive} onChange={update('isActive')} /> Doctor profile active</label><label><input type="checkbox" checked={form.clinicAssociationIsActive} onChange={update('clinicAssociationIsActive')} /> Clinic assignment active</label></div>
          {error && <div className="login-error" role="alert">{error}</div>}
          <footer className="doctor-editor-footer"><button type="button" className="subtle-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-small-button" disabled={submitting || creatingAccount || accountSubmitting}>{submitting ? 'Saving…' : doctor ? 'Save changes' : 'Create doctor profile'}</button></footer>
        </form>
      </section>
    </div>
  )
}

function Overview({ stats, appointments, loading, error, onRetry, onNavigate }) {
  const cards = [
    { label: 'Total clinics', value: stats?.clinics.total, meta: `${numberFormat.format(stats?.clinics.active || 0)} currently active`, icon: HeartPulse, tone: 'aqua' },
    { label: 'Care providers', value: stats?.doctors.total, meta: `${numberFormat.format(stats?.doctors.active || 0)} active profiles`, icon: Stethoscope, tone: 'blue' },
    { label: 'Patients served', value: stats?.patients.total, meta: 'Across your care network', icon: Users, tone: 'violet' },
    { label: 'Appointments', value: stats?.appointments.total, meta: `${numberFormat.format(stats?.appointments.byStatus?.confirmed || 0)} confirmed`, icon: CalendarDays, tone: 'amber', change: 'Live', up: null },
  ]
  const statuses = [
    { label: 'Confirmed', value: stats?.appointments.byStatus?.confirmed || 0, color: 'var(--cyan-600)' },
    { label: 'Completed', value: stats?.appointments.byStatus?.completed || 0, color: 'var(--navy-700)' },
    { label: 'Cancelled', value: stats?.appointments.byStatus?.cancelled || 0, color: '#b8c5d5' },
  ]
  const total = statuses.reduce((sum, item) => sum + item.value, 0)

  if (error) return <ErrorState message={error} onRetry={onRetry} />

  return (
    <div className="overview">
      <section className="welcome-banner">
        <div className="welcome-copy">
          <div className="welcome-kicker"><span className="welcome-live" /> YOUR CARE NETWORK</div>
          <h2>Care looks better<br />when it’s connected.</h2>
          <p>A clear view of your network helps every team deliver their best.</p>
          <button className="welcome-button" onClick={() => onNavigate('appointments')}>Explore appointments <ArrowRight size={16} /></button>
        </div>
        <div className="welcome-visual">
          <img src="https://images.unsplash.com/photo-1559757148-5c350d0d3c56?auto=format&fit=crop&w=900&q=85" alt="Healthcare team working together" />
          <div className="visual-shade" />
          <div className="visual-float"><span className="visual-float-icon"><HeartPulse size={17} /></span><div><strong>Care, connected</strong><span>Better outcomes start here</span></div><ArrowUpRight size={15} /></div>
          <div className="visual-ring ring-one" /><div className="visual-ring ring-two" />
        </div>
        <div className="welcome-orb orb-one" /><div className="welcome-orb orb-two" />
      </section>

      <div className="section-title-row"><div><h2>Network at a glance</h2><p>A real-time snapshot of your healthcare community.</p></div><span className="updated-label"><span /> Live overview</span></div>
      <div className="stat-grid">
        {cards.map(({ label, value, meta, icon: Icon, tone, change, up }) => (
          <article className="stat-card" key={label}>
            <div className="stat-card-top"><span className={`stat-icon ${tone}`}><Icon size={19} /></span><button className="more-button" aria-label={`More ${label} options`}><MoreHorizontal size={19} /></button></div>
            <span className="stat-label">{label}</span>
            <div className="stat-value">{loading ? <span className="skeleton-line stat-skeleton" /> : numberFormat.format(value || 0)}</div>
            <div className="stat-foot"><span>{meta}</span>{change && <span className={`stat-change ${up === false ? 'neutral-change' : ''}`}>{up ? <ArrowUpRight size={13} /> : null}{change}</span>}</div>
          </article>
        ))}
      </div>

      <div className="dashboard-grid">
        <section className="panel appointments-panel">
          <div className="panel-heading"><div><h2>Recent appointments</h2><p>Your latest patient visits</p></div><button className="text-button" onClick={() => onNavigate('appointments')}>View all <ArrowRight size={15} /></button></div>
          {loading ? <TableSkeleton compact /> : appointments.length ? <div className="mini-appointment-list">{appointments.slice(0, 5).map((appointment) => <MiniAppointment key={appointment._id} appointment={appointment} />)}</div> : <EmptyState page="appointments" compact />}
        </section>
        <section className="panel status-panel">
          <div className="panel-heading"><div><h2>Visit status</h2><p>Appointment distribution</p></div><span className="panel-menu"><MoreHorizontal size={18} /></span></div>
          <div className="donut-wrap">
            <div className="donut-chart" style={{ '--confirmed': total ? `${statuses[0].value / total * 100}%` : '0%', '--completed': total ? `${statuses[1].value / total * 100}%` : '0%' }}><div className="donut-center"><strong>{loading ? '—' : numberFormat.format(total)}</strong><span>Total visits</span></div></div>
          </div>
          <div className="status-legend">{statuses.map((status) => <div className="legend-row" key={status.label}><span className="legend-name"><i style={{ background: status.color }} />{status.label}</span><strong>{loading ? '—' : numberFormat.format(status.value)}</strong></div>)}</div>
        </section>
      </div>
      <div className="overview-bottom"><div><ShieldCheck size={16} /><span>Your dashboard is updated securely with the latest network data.</span></div><button onClick={() => onNavigate('clinics')}>Manage your network <ArrowRight size={15} /></button></div>
    </div>
  )
}

function MiniAppointment({ appointment }) {
  const patient = appointment.patient?.name || 'Patient'
  const doctor = appointment.doctor?.user?.name || 'Care provider'
  return (
    <div className="mini-appointment">
      <div className="avatar avatar-small">{initials(patient)}</div>
      <div className="mini-person"><strong>{patient}</strong><span>with {doctor}</span></div>
      <div className="mini-time"><strong>{formatDate(appointment.startAt, { month: 'short', day: 'numeric' })}</strong><span>{formatDate(appointment.startAt, { hour: 'numeric', minute: '2-digit' })}</span></div>
      <StatusPill status={appointment.status} />
    </div>
  )
}

function ClinicAdminEditor({ token, clinics, onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    clinicId: '',
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const activeClinics = clinics.filter((clinic) => clinic.isActive)

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    if (form.name.trim().length < 2 || form.name.trim().length > 100) {
      setError('Name must be between 2 and 100 characters.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError('Enter a valid email address.')
      return
    }
    if (!form.phone.trim() || form.phone.trim().length > 30) {
      setError('Enter a phone number of at most 30 characters.')
      return
    }
    if (Array.from(form.password).length < 12) {
      setError('Password must be at least 12 characters.')
      return
    }
    if (new TextEncoder().encode(form.password).length > 72) {
      setError('Password must not exceed 72 UTF-8 bytes.')
      return
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (!activeClinics.some((clinic) => String(clinic.id) === form.clinicId)) {
      setError('Select an active clinic.')
      return
    }

    setSubmitting(true)
    try {
      await api.post('/admin/clinic-admins', {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        password: form.password,
        clinicId: form.clinicId,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      })
      onCreated()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="editor-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="doctor-editor" role="dialog" aria-modal="true" aria-labelledby="clinic-admin-editor-title">
        <header className="doctor-editor-header"><div><span className="eyebrow">ADMIN ACCESS</span><h2 id="clinic-admin-editor-title">Add Clinic Admin</h2><p>Create a secure account limited to one clinic.</p></div><button className="icon-button" aria-label="Close Clinic Admin form" onClick={onClose}><X size={18} /></button></header>
        <form className="doctor-editor-form" onSubmit={submit}>
          <div className="doctor-form-grid">
            <label>Full name<input autoComplete="name" value={form.name} onChange={update('name')} required minLength={2} maxLength={100} /></label>
            <label>Email<input type="email" autoComplete="email" value={form.email} onChange={update('email')} required /></label>
            <label>Phone<input autoComplete="tel" value={form.phone} onChange={update('phone')} required maxLength={30} /></label>
            <label>Assigned clinic<select value={form.clinicId} onChange={update('clinicId')} required><option value="">Choose active clinic</option>{activeClinics.map((clinic) => <option value={clinic.id} key={clinic.id}>{clinic.name} · {clinic.city}</option>)}</select></label>
            <label>Password<input type="password" autoComplete="new-password" value={form.password} onChange={update('password')} required minLength={12} /></label>
            <label>Confirm password<input type="password" autoComplete="new-password" value={form.confirmPassword} onChange={update('confirmPassword')} required minLength={12} /></label>
          </div>
          {error && <div className="login-error" role="alert">{error}</div>}
          <footer className="doctor-editor-footer"><button type="button" className="subtle-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-small-button" disabled={submitting || activeClinics.length === 0}>{submitting ? 'Creating account…' : 'Create Clinic Admin'}</button></footer>
        </form>
      </section>
    </div>
  )
}

function ClinicAdminTable({ rows, onToggleStatus }) {
  return (
    <div className="table-scroll"><table><thead><tr><th>CLINIC ADMIN</th><th>PHONE</th><th>ASSIGNED CLINIC</th><th>ACCOUNT STATUS</th><th>CREATED</th><th>ACCOUNT CONTROL</th></tr></thead><tbody>
      {rows.map((admin) => <tr key={admin._id}><td><div className="table-person"><span className="avatar table-avatar">{initials(admin.name)}</span><div><strong>{admin.name}</strong><span>{admin.email}</span></div></div></td><td>{admin.phone || '—'}</td><td><span className="main-cell">{admin.clinic?.name || 'Clinic unavailable'}</span><span className="sub-cell">{admin.clinic?.city || ''}</span></td><td><StatusPill status={admin.isActive ? 'active' : 'inactive'} /></td><td>{formatDate(admin.createdAt)}</td><td><button className="row-edit-button" onClick={() => onToggleStatus(admin)}>{admin.isActive ? 'Deactivate' : 'Activate'}</button></td></tr>)}
    </tbody></table></div>
  )
}

function DataTable({ page, rows, onAppointmentCancel, onEditDoctor, onEditClinic, onToggleUserStatus }) {
  if (page === 'clinics') {
    return <div className="table-scroll"><table><thead><tr><th>CLINIC</th><th>LOCATION</th><th>CONTACT</th><th>BRANCHES</th><th>STATUS</th><th>ADDED</th><th /></tr></thead><tbody>{rows.map((clinic) => <tr key={clinic.id}><td><div className="table-person"><span className="table-avatar clinic-avatar">{clinic.logo ? <img src={clinic.logo} alt="" /> : <HeartPulse size={17} />}</span><div><strong>{clinic.name}</strong><span>{clinic.email || 'Healthcare facility'}</span></div></div></td><td><span className="main-cell">{[clinic.city, clinic.state].filter(Boolean).join(', ') || '—'}</span><span className="sub-cell">{clinic.address || ''}</span></td><td><span className="main-cell">{clinic.phone || '—'}</span></td><td><span className="branch-count">{clinic.branches?.filter((branch) => branch.isActive).length || 0} active locations</span></td><td><StatusPill status={clinic.isActive ? 'active' : 'inactive'} /></td><td>{formatDate(clinic.createdAt)}</td><td><button className="row-edit-button" onClick={() => onEditClinic(clinic)}>Edit</button></td></tr>)}</tbody></table></div>
  }

  if (page === 'doctors') {
    return <div className="table-scroll"><table><thead><tr><th>DOCTOR</th><th>SPECIALTY</th><th>EXPERIENCE</th><th>CONSULTATION</th><th>CLINIC / HOURS</th><th>STATUS</th><th>JOINED</th><th />{onToggleUserStatus && <th>ACCOUNT</th>}</tr></thead><tbody>{rows.map((doctor) => {
      const associations = doctor.clinicAssociations || []
      const locations = associations.map((association) => association.branch?.name || association.clinic?.name).filter(Boolean).join(', ')
      const fee = doctor.consultationFeeInr ?? doctor.consultationFee
      const active = doctor.isActive && doctor.user?.isActive
      return <tr key={doctor._id}><td><div className="table-person"><span className="avatar table-avatar">{doctor.profileImage ? <img src={doctor.profileImage} alt="" /> : initials(doctor.user?.name)}</span><div><strong>{doctor.user?.name || 'Doctor profile'}</strong><span>{doctor.user?.email || '—'}</span></div></div></td><td><span className="specialty-chip">{doctor.specialty?.name || 'General practice'}</span></td><td>{doctor.experienceYears ?? '—'}{doctor.experienceYears === 1 ? ' year' : ' years'}</td><td><strong className="fee-value">{fee == null ? '—' : `₹${numberFormat.format(fee)}`}</strong><span className="sub-cell">{doctor.consultationDurationMinutes || 30} min</span></td><td><span className="main-cell">{locations || 'Not assigned'}</span><span className="sub-cell">{associations.some((association) => association.weeklySchedule?.length) ? 'Schedule configured · IST' : 'No hours configured'}</span></td><td><StatusPill status={active ? 'active' : 'inactive'} /></td><td>{formatDate(doctor.createdAt)}</td><td><button className="row-edit-button" onClick={() => onEditDoctor(doctor)}>Edit profile</button></td>{onToggleUserStatus && doctor.user && <td><button className="row-edit-button" onClick={() => onToggleUserStatus(doctor.user)}>{doctor.user.isActive ? 'Deactivate' : 'Activate'} account</button></td>}</tr>
    })}</tbody></table></div>
  }

  if (page === 'patients') {
    return <div className="table-scroll"><table><thead><tr><th>PATIENT</th><th>PHONE</th><th>ACCOUNT STATUS</th><th>REGISTERED</th><th>ROLE</th>{onToggleUserStatus && <th>ACCOUNT CONTROL</th>}</tr></thead><tbody>{rows.map((patient) => <tr key={patient._id}><td><div className="table-person"><span className="avatar table-avatar patient-avatar">{initials(patient.name)}</span><div><strong>{patient.name}</strong><span>{patient.email}</span></div></div></td><td>{patient.phone || '—'}</td><td><StatusPill status={patient.isActive ? 'active' : 'inactive'} /></td><td>{formatDate(patient.createdAt)}</td><td><span className="role-label">Patient</span></td>{onToggleUserStatus && <td><button className="row-edit-button" onClick={() => onToggleUserStatus(patient)}>{patient.isActive ? 'Deactivate' : 'Activate'}</button></td>}</tr>)}</tbody></table></div>
  }

  return <div className="table-scroll"><table className="appointment-table"><thead><tr><th>APPOINTMENT</th><th>DOCTOR</th><th>CLINIC</th><th>DATE & TIME</th><th>FEE</th><th>REASON</th><th>STATUS</th><th /></tr></thead><tbody>{rows.map((appointment) => <tr key={appointment._id}><td><div className="table-person"><span className="avatar table-avatar patient-avatar">{initials(appointment.patient?.name)}</span><div><strong>{appointment.patient?.name || 'Patient'}</strong><span>{appointment.patient?.email || 'Patient visit'}</span></div></div></td><td><span className="main-cell">{appointment.doctor?.user?.name || 'Doctor'}</span><span className="sub-cell">{appointment.doctor?.specialty?.name || 'Care provider'}</span></td><td><span className="main-cell">{appointment.branch?.name || appointment.clinic?.name || '—'}</span><span className="sub-cell">{appointment.branch?.city || appointment.clinic?.city || ''}</span></td><td><span className="main-cell">{formatDate(appointment.startAt)}</span><span className="sub-cell">{formatDate(appointment.startAt, { hour: 'numeric', minute: '2-digit' })} IST</span></td><td>{appointment.consultationFeeInr == null ? '—' : `₹${numberFormat.format(appointment.consultationFeeInr)}`}</td><td className="reason-cell">{appointment.reason || '—'}</td><td><StatusPill status={appointment.status} /></td><td>{appointment.status === 'confirmed' && <button className="row-action" title="Cancel appointment" aria-label={`Cancel appointment for ${appointment.patient?.name || 'patient'}`} onClick={() => onAppointmentCancel(appointment)}><X size={15} /></button>}</td></tr>)}</tbody></table></div>
}

function StatusPill({ status }) {
  const label = status?.charAt(0).toUpperCase() + status?.slice(1)
  return <span className={`status-pill status-${status}`}>{status === 'confirmed' || status === 'active' ? <i /> : null}{label || 'Unknown'}</span>
}

function Pagination({ pagination, onPageChange }) {
  const current = pagination.page || 1
  const pages = Math.max(pagination.pages || 1, 1)
  const start = pagination.total ? (current - 1) * pagination.limit + 1 : 0
  const end = Math.min(current * pagination.limit, pagination.total || 0)
  return (
    <div className="pagination">
      <span>Showing <strong>{start}–{end}</strong> of <strong>{numberFormat.format(pagination.total || 0)}</strong></span>
      <div className="pagination-controls">
        <button aria-label="Previous page" disabled={current <= 1} onClick={() => onPageChange(current - 1)}><ChevronLeft size={17} /></button>
        <span>Page <strong>{current}</strong> of {pages}</span>
        <button aria-label="Next page" disabled={current >= pages} onClick={() => onPageChange(current + 1)}><ChevronRight size={17} /></button>
      </div>
    </div>
  )
}

function ErrorState({ message, onRetry }) {
  return <div className="state-box error-state"><span className="state-icon"><Activity size={20} /></span><h3>We couldn’t load this view</h3><p>{message}</p>{onRetry && <button className="secondary-button" onClick={onRetry}>Try again</button>}</div>
}

function EmptyState({ page, searching, compact = false }) {
  const messages = {
    clinics: ['No clinics found', 'Clinics in your network will appear here.'],
    clinicAdmins: ['No Clinic Admins found', 'Create an account to grant clinic-specific access.'],
    doctors: ['No doctors found', 'Try another search or check back later.'],
    patients: ['No patients found', 'Patients in your network will appear here.'],
    appointments: ['No appointments yet', 'New patient visits will show up here.'],
  }
  const [title, description] = messages[page] || messages.clinics
  return <div className={`state-box empty-state ${compact ? 'empty-compact' : ''}`}><span className="state-icon"><Search size={19} /></span><h3>{searching ? 'No matching results' : title}</h3><p>{searching ? 'Try adjusting your search or filters.' : description}</p></div>
}

function TableSkeleton({ compact = false }) {
  return <div className={`table-skeleton ${compact ? 'skeleton-compact' : ''}`} aria-label="Loading records">{Array.from({ length: compact ? 4 : 6 }, (_, index) => <div className="skeleton-row" key={index}><span className="skeleton-circle" /><span className="skeleton-line skeleton-long" /><span className="skeleton-line skeleton-mid" /><span className="skeleton-line skeleton-short" /></div>)}</div>
}

function App() {
  const [pathname, setPathname] = useState(window.location.pathname)

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  if (pathname.startsWith('/admin')) return <AdminPortal />
  if (pathname.startsWith('/doctor')) return <DoctorPortal pathname={pathname} />
  return <PatientPortal key="patient-portal" />
}

export default App
