import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import api from './api'
import {
  Bell,
  CalendarDays,
  Check,
  Clock3,
  HeartPulse,
  LogOut,
  Pencil,
  ShieldCheck,
  Stethoscope,
  UserRound,
  X,
} from 'lucide-react'
import './DoctorPortal.css'

const SESSION_KEY = 'healpoint.doctor.session'
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const formatDate = (value, options = { month: 'short', day: 'numeric', year: 'numeric' }) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-IN', { ...options, timeZone: 'Asia/Kolkata' }).format(date)
}
const errorMessage = (error) =>
  error.response?.data?.message || error.message || 'Something went wrong. Please try again.'

const readStoredSession = () => {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    sessionStorage.removeItem(SESSION_KEY)
    return null
  }
}

const navigate = (path) => {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function DoctorPortal({ pathname }) {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(() => Boolean(readStoredSession()?.token))
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    const stored = readStoredSession()
    if (!stored?.token) return
    const controller = new AbortController()
    api.get('/auth/me/', {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${stored.token}` },
    }).then(({ data }) => {
      if (data.data.user.role !== 'doctor') throw new Error('This sign-in is for doctor accounts only.')
      const verified = { token: stored.token, user: data.data.user }
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(verified))
      setSession(verified)
    }).catch((error) => {
      if (axios.isCancel(error)) return
      sessionStorage.removeItem(SESSION_KEY)
      if (error.message.includes('doctor accounts')) setAuthError(error.message)
    }).finally(() => setAuthLoading(false))
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (session && pathname !== '/doctor/dashboard') navigate('/doctor/dashboard')
  }, [session, pathname])

  const logout = useCallback(() => {
    const stored = readStoredSession()
    sessionStorage.removeItem(SESSION_KEY)
    setSession(null)
    setAuthError('')
    navigate('/doctor/login')
    if (stored?.token) {
      api.post('/auth/logout/', {}, {
        headers: { Authorization: `Bearer ${stored.token}` },
      }).catch(() => {})
    }
  }, [])

  const login = async (email, password) => {
    setAuthError('')
    try {
      const { data } = await api.post('/auth/login/', { email, password })
      if (data.data.user.role !== 'doctor') {
        setAuthError('This sign-in is for doctor accounts only.')
        return
      }
      const next = { token: data.data.token, user: data.data.user }
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(next))
      setSession(next)
      navigate('/doctor/dashboard')
    } catch (error) {
      setAuthError(errorMessage(error))
    }
  }

  if (authLoading) {
    return <div className="doctor-auth-loading"><span /> Securing your workspace…</div>
  }
  if (!session || pathname !== '/doctor/dashboard') {
    return <DoctorLogin onLogin={login} error={authError} submitting={authLoading} />
  }
  return <DoctorDashboard session={session} onLogout={logout} />
}

function DoctorLogin({ onLogin, error, submitting }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setLoading(true)
    await onLogin(email.trim(), password)
    setLoading(false)
  }

  return (
    <main className="doctor-login-page">
      <a className="doctor-login-brand" href="/" onClick={(event) => { event.preventDefault(); navigate('/') }}>
        <HeartPulse size={22} /> HealPoint
      </a>
      <section className="doctor-login-card">
        <span className="doctor-login-icon"><Stethoscope size={22} /></span>
        <span className="doctor-eyebrow">DOCTOR WORKSPACE</span>
        <h1>Welcome back</h1>
        <p>Sign in to review your schedule and patient appointments.</p>
        <form onSubmit={submit}>
          <label>Email address<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {error && <div className="doctor-form-error" role="alert">{error}</div>}
          <button type="submit" disabled={loading || submitting}>{loading ? 'Signing in…' : 'Sign in securely'}</button>
        </form>
        <button className="doctor-login-public-link" onClick={() => navigate('/')}>Return to HealPoint</button>
      </section>
      <p className="doctor-login-security"><ShieldCheck size={14} /> Protected access for authorized doctor accounts</p>
    </main>
  )
}

function DoctorDashboard({ session, onLogout }) {
  const [doctor, setDoctor] = useState(null)
  const [appointments, setAppointments] = useState([])
  const [appointmentStats, setAppointmentStats] = useState(null)
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 })
  const [page, setPage] = useState(1)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notificationError, setNotificationError] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileForm, setProfileForm] = useState(null)
  const headers = useMemo(() => ({ Authorization: `Bearer ${session.token}` }), [session.token])

  const loadDashboard = useCallback(async (signal) => {
    setLoading(true)
    setError('')
    try {
      const [profileResponse, appointmentResponse] = await Promise.all([
        api.get('/doctors/me', { signal, headers }),
        api.get('/appointments', { signal, headers, params: { page, limit: 10 } }),
      ])
      setDoctor(profileResponse.data.data.doctor)
      setAppointments(appointmentResponse.data.data.appointments || [])
      setAppointmentStats(appointmentResponse.data.data.stats || null)
      setPagination(appointmentResponse.data.pagination || { page: 1, pages: 1, total: 0 })
    } catch (requestError) {
      if (!axios.isCancel(requestError)) setError(errorMessage(requestError))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [headers, page])

  const loadNotifications = useCallback(async (signal) => {
    try {
      const { data } = await api.get('/notifications', {
        signal,
        headers,
        params: { limit: 10 },
      })
      setNotifications(data.data.notifications || [])
      setUnreadCount(data.data.unreadCount || 0)
      setNotificationError('')
    } catch (requestError) {
      if (!axios.isCancel(requestError)) setNotificationError(errorMessage(requestError))
    }
  }, [headers])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => loadDashboard(controller.signal), 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [loadDashboard])

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
      await api.patch(`/notifications/${notification._id}/read`, {}, { headers })
      setNotifications((items) => items.map((item) =>
        item._id === notification._id
          ? { ...item, readAt: item.readAt || new Date().toISOString() }
          : item
      ))
      if (!notification.readAt) setUnreadCount((count) => Math.max(0, count - 1))
    } catch (requestError) {
      setNotificationError(errorMessage(requestError))
    }
  }

  const markAllRead = async () => {
    try {
      await api.patch('/notifications/read-all', {}, { headers })
      const readAt = new Date().toISOString()
      setNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt || readAt })))
      setUnreadCount(0)
    } catch (requestError) {
      setNotificationError(errorMessage(requestError))
    }
  }

  const completeAppointment = async (appointment) => {
    if (!window.confirm('Mark this appointment as completed?')) return
    try {
      await api.patch(`/appointments/${appointment._id}/status`, { status: 'completed' }, { headers })
      await loadDashboard()
      await loadNotifications()
    } catch (requestError) {
      setError(errorMessage(requestError))
    }
  }

  const openProfile = () => {
    if (!doctor) return
    setProfileForm({
      name: doctor.user?.name || '',
      qualification: doctor.qualification || '',
      experienceYears: String(doctor.experienceYears ?? 0),
      profileImage: doctor.profileImage || '',
      bio: doctor.bio || '',
      languagesSpoken: (doctor.languagesSpoken || []).join(', '),
    })
    setProfileError('')
    setProfileOpen(true)
  }

  const saveProfile = async (event) => {
    event.preventDefault()
    setProfileError('')
    if (profileForm.name.trim().length < 2) {
      setProfileError('Enter your full name.')
      return
    }
    if (!profileForm.qualification.trim()) {
      setProfileError('Enter your qualification.')
      return
    }
    setProfileSaving(true)
    try {
      const { data } = await api.put(`/doctors/${doctor.id}`, {
        name: profileForm.name.trim(),
        qualification: profileForm.qualification.trim(),
        experienceYears: Number(profileForm.experienceYears),
        profileImage: profileForm.profileImage.trim(),
        bio: profileForm.bio.trim(),
        languagesSpoken: profileForm.languagesSpoken.split(',').map((item) => item.trim()).filter(Boolean),
      }, { headers })
      setDoctor(data.data.doctor)
      setProfileOpen(false)
    } catch (requestError) {
      setProfileError(errorMessage(requestError))
    } finally {
      setProfileSaving(false)
    }
  }

  return (
    <main className="doctor-dashboard-page">
      <header className="doctor-dashboard-header">
        <button className="doctor-dashboard-brand" onClick={() => navigate('/doctor/dashboard')}><HeartPulse size={21} /> HealPoint <span>DOCTOR</span></button>
        <div className="doctor-dashboard-actions">
          <div className="doctor-notifications">
            <button aria-label={`${unreadCount} unread notifications`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}><Bell size={18} />{unreadCount > 0 && <span>{unreadCount > 99 ? '99+' : unreadCount}</span>}</button>
            {notificationsOpen && <div className="doctor-notification-panel">
              <div><strong>Notifications</strong><button onClick={markAllRead} disabled={!unreadCount}>Mark all read</button></div>
              {notificationError ? <p role="alert">{notificationError}</p> : notifications.length ? notifications.map((item) => <button key={item._id} className={item.readAt ? '' : 'doctor-notification-unread'} onClick={() => !item.readAt && markRead(item)}><strong>{item.title}</strong><span>{item.message}</span><small>{formatDate(item.createdAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small></button>) : <p>You’re all caught up.</p>}
            </div>}
          </div>
          <span className="doctor-header-name">{session.user.name}</span>
          <button className="doctor-logout-button" onClick={onLogout}><LogOut size={15} /> Sign out</button>
        </div>
      </header>

      <div className="doctor-dashboard-content">
        <section className="doctor-welcome">
          <div><span className="doctor-eyebrow">YOUR CLINICAL WORKSPACE</span><h1>{doctor?.user?.name ? `Good day, ${doctor.user.name.split(' ')[0]}` : 'Doctor dashboard'}</h1><p>Review your appointments, clinic schedule, and patient visits.</p></div>
          <button className="doctor-edit-profile" onClick={openProfile} disabled={!doctor}><Pencil size={15} /> Edit profile</button>
        </section>

        {error && <div className="doctor-dashboard-error" role="alert"><span>{error}</span><button onClick={() => loadDashboard()}>Try again</button></div>}

        <section className="doctor-stats-grid" aria-label="Appointment statistics">
          {[
            ['Upcoming', appointmentStats?.upcoming, CalendarDays],
            ['Confirmed', appointmentStats?.byStatus?.confirmed, Clock3],
            ['Completed', appointmentStats?.byStatus?.completed, Check],
            ['Total visits', appointmentStats?.total, UserRound],
          ].map(([label, value, Icon]) => <article className="doctor-stat-card" key={label}><span><Icon size={18} /></span><small>{label}</small><strong>{loading ? '—' : value ?? 0}</strong></article>)}
        </section>

        <div className="doctor-dashboard-grid">
          <section className="doctor-panel doctor-appointments-panel">
            <div className="doctor-panel-heading"><div><h2>Appointments</h2><p>{loading ? 'Loading appointments…' : `${pagination.total || 0} in your care`}</p></div><CalendarDays size={18} /></div>
            {loading ? <div className="doctor-empty-state">Loading your schedule…</div> : appointments.length === 0 ? <div className="doctor-empty-state"><CalendarDays size={23} /><strong>No appointments yet</strong><span>Your booked patient visits will appear here.</span></div> : <div className="doctor-appointment-list">
              {appointments.map((appointment) => {
                const start = new Date(appointment.startAt)
                const canComplete = appointment.status === 'confirmed' && start <= new Date()
                const clinic = appointment.branch || appointment.clinic
                return <article className="doctor-appointment-card" key={appointment._id}>
                  <div className="doctor-appointment-date"><strong>{formatDate(appointment.startAt, { day: '2-digit' })}</strong><span>{formatDate(appointment.startAt, { month: 'short' }).toUpperCase()}</span></div>
                  <div className="doctor-appointment-details"><strong>{appointment.patient?.name || 'Patient'}</strong><span>{formatDate(appointment.startAt, { weekday: 'short', hour: 'numeric', minute: '2-digit' })} IST · {appointment.durationMinutes || doctor?.consultationDurationMinutes || 30} min</span><span>{clinic?.name || 'Clinic'}{clinic?.city ? ` · ${clinic.city}` : ''}</span>{appointment.patient?.phone && <a href={`tel:${appointment.patient.phone}`}>Patient phone: {appointment.patient.phone}</a>}{appointment.reason && <small>Visit reason: {appointment.reason}</small>}</div>
                  <div className="doctor-appointment-status"><span className={`doctor-status doctor-status-${appointment.status}`}>{appointment.status}</span>{canComplete && <button onClick={() => completeAppointment(appointment)}>Complete</button>}</div>
                </article>
              })}
            </div>}
            {!loading && pagination.pages > 1 && <div className="doctor-pagination"><button disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button><span>Page {page} of {pagination.pages}</span><button disabled={page >= pagination.pages} onClick={() => setPage((current) => current + 1)}>Next</button></div>}
          </section>

          <section className="doctor-panel doctor-schedule-panel">
            <div className="doctor-panel-heading"><div><h2>Weekly availability</h2><p>Clinic-managed schedule · India Standard Time</p></div><Clock3 size={18} /></div>
            {loading ? <div className="doctor-empty-state">Loading availability…</div> : doctor?.clinics?.length ? doctor.clinics.map((association) => <div className="doctor-clinic-schedule" key={association.clinicDoctorId}>
              <strong>{association.branch?.name || association.name}</strong><span>{association.city}{association.state ? `, ${association.state}` : ''}</span>
              {association.weeklySchedule?.length ? <ul>{[...association.weeklySchedule].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime)).map((slot, index) => <li key={`${association.clinicDoctorId}-${index}`}><span>{weekdays[slot.dayOfWeek]}</span><time>{slot.startTime}–{slot.endTime}</time></li>)}</ul> : <p>No visiting hours configured. Contact your clinic administrator.</p>}
            </div>) : <div className="doctor-empty-state"><Stethoscope size={23} /><strong>No active clinic assignments</strong><span>Contact your clinic administrator to be assigned and scheduled.</span></div>}
          </section>
        </div>
        <footer className="doctor-dashboard-footer"><ShieldCheck size={15} /> Patient information is limited to appointments assigned to your doctor account.</footer>
      </div>

      {profileOpen && profileForm && <div className="doctor-profile-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileOpen(false) }}>
        <section className="doctor-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="doctor-profile-title">
          <header><div><span className="doctor-eyebrow">DOCTOR PROFILE</span><h2 id="doctor-profile-title">Edit your profile</h2></div><button aria-label="Close profile editor" onClick={() => setProfileOpen(false)}><X size={18} /></button></header>
          <form onSubmit={saveProfile}>
            <label>Full name<input value={profileForm.name} maxLength={100} onChange={(event) => setProfileForm((current) => ({ ...current, name: event.target.value }))} required /></label>
            <label>Qualification<input value={profileForm.qualification} maxLength={200} onChange={(event) => setProfileForm((current) => ({ ...current, qualification: event.target.value }))} required /></label>
            <label>Experience (years)<input type="number" min="0" max="80" step="1" value={profileForm.experienceYears} onChange={(event) => setProfileForm((current) => ({ ...current, experienceYears: event.target.value }))} required /></label>
            <label>Profile photo URL<input type="url" value={profileForm.profileImage} onChange={(event) => setProfileForm((current) => ({ ...current, profileImage: event.target.value }))} /></label>
            <label>Languages spoken<input value={profileForm.languagesSpoken} onChange={(event) => setProfileForm((current) => ({ ...current, languagesSpoken: event.target.value }))} placeholder="English, Hindi" /></label>
            <label>About<textarea rows={3} maxLength={3000} value={profileForm.bio} onChange={(event) => setProfileForm((current) => ({ ...current, bio: event.target.value }))} /></label>
            {profileError && <p className="doctor-form-error" role="alert">{profileError}</p>}
            <footer><button type="button" className="doctor-profile-cancel" onClick={() => setProfileOpen(false)}>Cancel</button><button type="submit" disabled={profileSaving}>{profileSaving ? 'Saving…' : 'Save profile'}</button></footer>
          </form>
        </section>
      </div>}
    </main>
  )
}

export default DoctorPortal
