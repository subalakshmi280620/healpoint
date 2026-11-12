import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import api from './api'
import {
  ArrowRight,
  Bell,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  HeartPulse,
  LogOut,
  MapPin,
  Menu,
  Search,
  ShieldCheck,
  Stethoscope,
  UserRound,
  X,
} from 'lucide-react'
import './PatientPortal.css'

const PATIENT_SESSION_KEY = 'healpoint.patient.session'
const PENDING_BOOKING_KEY = 'healpoint.patient.pending-booking'
const PAGE_SIZE = 8

const formatDate = (value, options = { month: 'short', day: 'numeric', year: 'numeric' }) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-IN', { ...options, timeZone: 'Asia/Kolkata' }).format(date)
}

const formatDistance = (distanceKm) => {
  if (distanceKm === null || distanceKm === undefined || distanceKm === '') return ''
  const distance = Number(distanceKm)
  return Number.isFinite(distance) ? `${distance.toFixed(1)} km away` : ''
}

const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()

const getIstDateString = (date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

const shiftCalendarDate = (dateString, days) => {
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

const scheduleLabel = (schedule = []) => {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return schedule.map((window) =>
    `${days[window.dayOfWeek]} ${window.startTime}–${window.endTime}`
  ).join(', ')
}

const errorMessage = (error) =>
  error.response?.data?.message || error.message || 'Something went wrong. Please try again.'

const getPendingBooking = () => {
  const pending = sessionStorage.getItem(PENDING_BOOKING_KEY)
  if (!pending) return null
  try {
    return JSON.parse(pending)
  } catch {
    return null
  }
}

const takePendingBooking = () => {
  const pending = getPendingBooking()
  sessionStorage.removeItem(PENDING_BOOKING_KEY)
  return pending
}

const getStoredSession = () => {
  try {
    const stored = sessionStorage.getItem(PATIENT_SESSION_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    sessionStorage.removeItem(PATIENT_SESSION_KEY)
    return null
  }
}

function usePathname() {
  const [pathname, setPathname] = useState(window.location.pathname)
  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  const navigate = useCallback((path) => {
    if (window.location.pathname !== path) window.history.pushState({}, '', path)
    setPathname(path)
    window.dispatchEvent(new PopStateEvent('popstate'))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])
  return [pathname, navigate]
}

export default function PatientPortal() {
  const [pathname, navigate] = usePathname()
  const [session, setSession] = useState(null)
  const [sessionLoading, setSessionLoading] = useState(() => Boolean(getStoredSession()?.token))
  const [sessionError, setSessionError] = useState('')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [bookingDoctor, setBookingDoctor] = useState(getPendingBooking)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    sessionStorage.removeItem(PENDING_BOOKING_KEY)
  }, [])

  useEffect(() => {
    const stored = getStoredSession()
    if (!stored?.token) return
    const controller = new AbortController()
    api.get('/auth/me/', {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${stored.token}` },
    }).then(({ data }) => {
      if (data.data.user.role !== 'patient') throw new Error('This sign-in is for patient accounts only.')
      const verifiedSession = { token: stored.token, user: data.data.user }
      sessionStorage.setItem(PATIENT_SESSION_KEY, JSON.stringify(verifiedSession))
      setSession(verifiedSession)
    }).catch((error) => {
      if (axios.isCancel(error)) return
      sessionStorage.removeItem(PATIENT_SESSION_KEY)
      if (error.message.includes('patient accounts')) setSessionError(error.message)
    }).finally(() => setSessionLoading(false))
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(''), 3500)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (session && pathname === '/login') navigate('/dashboard')
  }, [session, pathname, navigate])

  useEffect(() => {
    if (!sessionLoading && !session && pathname === '/dashboard') navigate('/login')
  }, [session, sessionLoading, pathname, navigate])

  const signOut = () => {
    const stored = getStoredSession()
    sessionStorage.removeItem(PATIENT_SESSION_KEY)
    setSession(null)
    setBookingDoctor(null)
    navigate('/')
    if (stored?.token) {
      api.post('/auth/logout/', {}, {
        headers: { Authorization: `Bearer ${stored.token}` },
      }).catch(() => {})
    }
  }

  const openBooking = (doctor) => {
    if (!session) {
      sessionStorage.setItem(PENDING_BOOKING_KEY, JSON.stringify(doctor))
      navigate('/login')
      return
    }
    setBookingDoctor(doctor)
    navigate('/dashboard')
  }

  const onAuthenticated = (nextSession) => {
    sessionStorage.setItem(PATIENT_SESSION_KEY, JSON.stringify(nextSession))
    const pendingDoctor = takePendingBooking()
    if (pendingDoctor) setBookingDoctor(pendingDoctor)
    setSession(nextSession)
    navigate('/dashboard')
  }

  if (sessionLoading) {
    return <div className="patient-loading"><span className="patient-spinner" /> Securing your account…</div>
  }

  if (pathname === '/login' || pathname === '/register') {
    return (
      <PatientAuth
        key={pathname}
        mode={pathname === '/register' ? 'register' : 'login'}
        error={sessionError}
        onModeChange={(mode) => {
          setSessionError('')
          navigate(mode === 'register' ? '/register' : '/login')
        }}
        onAuthenticated={onAuthenticated}
        onBrowse={() => navigate('/')}
      />
    )
  }

  if (pathname === '/dashboard' && !session) {
    return <div className="patient-loading"><span className="patient-spinner" /> Redirecting to sign in…</div>
  }

  if (pathname === '/dashboard' && session) {
    return (
      <PatientDashboard
        session={session}
        onProfileUpdated={(user) => {
          const nextSession = { ...session, user }
          sessionStorage.setItem(PATIENT_SESSION_KEY, JSON.stringify(nextSession))
          setSession(nextSession)
        }}
        onBrowse={() => navigate('/')}
        onSignOut={signOut}
        initialDoctor={bookingDoctor}
        onBookingClose={() => setBookingDoctor(null)}
        onBookingComplete={() => {
          setBookingDoctor(null)
          setNotice('Your appointment is confirmed.')
        }}
        notice={notice}
      />
    )
  }

  return (
    <PatientHome
      session={session}
      mobileMenuOpen={mobileMenuOpen}
      setMobileMenuOpen={setMobileMenuOpen}
      onNavigate={navigate}
      onBook={openBooking}
      notice={notice}
      onSignOut={signOut}
    />
  )
}

function PatientAuth({ mode, error: inheritedError, onModeChange, onAuthenticated, onBrowse }) {
  const registering = mode === 'register'
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirmPassword: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }))
    if (error) setError('')
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    if (registering) {
      if (form.name.trim().length < 2) return setError('Please enter your full name.')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setError('Enter a valid email address.')
      if (form.phone.trim().length < 7) return setError('Enter a valid phone number.')
      if (Array.from(form.password).length < 12) return setError('Password must be at least 12 characters.')
      if (new TextEncoder().encode(form.password).length > 72) return setError('Password must not exceed 72 UTF-8 bytes.')
      if (form.password !== form.confirmPassword) return setError('Your passwords do not match.')
    }

    setSubmitting(true)
    try {
      const path = registering ? '/auth/register/' : '/auth/login/'
      const body = registering
        ? { name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), password: form.password, role: 'patient' }
        : { email: form.email.trim(), password: form.password }
      const { data } = await api.post(path, body)
      if (data.data.user.role !== 'patient') {
        setError('This sign-in is for patient accounts only.')
        return
      }
      onAuthenticated({ token: data.data.token, user: data.data.user })
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="patient-auth-page patient-enter">
      <header className="patient-public-header auth-header">
        <Brand onClick={onBrowse} />
        <div className="public-header-actions">
          <span className="auth-header-prompt">{registering ? 'Already have an account?' : 'New to HealPoint?'}</span>
          <button className="patient-outline-button" onClick={() => onModeChange(registering ? 'login' : 'register')}>
            {registering ? 'Sign in' : 'Create account'}
          </button>
        </div>
      </header>
      <div className="auth-backdrop auth-backdrop-left" />
      <div className="auth-backdrop auth-backdrop-right" />
      <main className="patient-auth-main">
        <div className="auth-image-panel">
          <div className="auth-image-overlay" />
          <div className="auth-image-content">
            <span className="auth-image-kicker"><span /> YOUR HEALTH, IN GOOD HANDS</span>
            <h1>Care that starts<br />with listening.</h1>
            <p>Find the right care team, book with confidence, and keep your health journey in one place.</p>
            <div className="auth-image-trust"><span className="trust-icon"><ShieldCheck size={18} /></span><span><strong>Private by design</strong><small>Your health information stays protected.</small></span></div>
          </div>
          <div className="auth-image-caption">Here for every step of your care journey.</div>
        </div>
        <section className="auth-card">
          <span className="auth-mobile-brand"><HeartPulse size={22} /> healpoint</span>
          <div className="auth-card-heading">
            <span className="patient-eyebrow">{registering ? 'PATIENT REGISTRATION' : 'PATIENT PORTAL'}</span>
            <h2>{registering ? 'Create your account' : 'Welcome back'}</h2>
            <p>{registering ? 'A healthier connection begins with a few details.' : 'Sign in to manage appointments and continue your care.'}</p>
          </div>
          {inheritedError && <div className="patient-form-error" role="alert">{inheritedError}</div>}
          <form className="patient-auth-form" onSubmit={submit} noValidate>
            {registering && (
              <>
                <label htmlFor="patient-name">Full name</label>
                <div className="patient-input-wrap"><UserRound size={17} /><input id="patient-name" autoComplete="name" placeholder="Your full name" value={form.name} onChange={update('name')} required /></div>
              </>
            )}
            <label htmlFor="patient-email">Email address</label>
            <div className="patient-input-wrap"><span className="input-at">@</span><input id="patient-email" type="email" autoComplete="email" placeholder="you@example.com" value={form.email} onChange={update('email')} required /></div>
            {registering && (
              <>
                <label htmlFor="patient-phone">Phone number</label>
                <div className="patient-input-wrap"><span className="input-phone">+1</span><input id="patient-phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="(555) 000-0000" value={form.phone} onChange={update('phone')} required /></div>
              </>
            )}
            <label htmlFor="patient-password">Password</label>
            <div className="patient-input-wrap"><span className="input-lock"><ShieldCheck size={16} /></span><input id="patient-password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} placeholder={registering ? 'At least 12 characters' : 'Enter your password'} value={form.password} onChange={update('password')} required /></div>
            {registering && (
              <>
                <label htmlFor="patient-confirm-password">Confirm password</label>
                <div className="patient-input-wrap"><Check size={16} /><input id="patient-confirm-password" type="password" autoComplete="new-password" placeholder="Re-enter your password" value={form.confirmPassword} onChange={update('confirmPassword')} required /></div>
              </>
            )}
            {error && <div className="patient-form-error" role="alert">{error}</div>}
            <button type="submit" className="patient-primary-button auth-submit" disabled={submitting}>
              {submitting ? <><span className="patient-button-spinner" /> {registering ? 'Creating account…' : 'Signing in…'}</> : <>{registering ? 'Create patient account' : 'Sign in to your account'} <ArrowRight size={17} /></>}
            </button>
          </form>
          <p className="auth-switch">{registering ? 'Already registered?' : 'First time here?'} <button onClick={() => onModeChange(registering ? 'login' : 'register')}>{registering ? 'Sign in' : 'Create a patient account'}</button></p>
          <div className="auth-security"><ShieldCheck size={15} /> Secure, private access to your care.</div>
          <button className="browse-link" onClick={onBrowse}><ChevronLeft size={15} /> Continue browsing clinics and doctors</button>
        </section>
      </main>
      <footer className="patient-auth-footer"><span>© 2025 HealPoint Health Systems</span><button onClick={() => { window.history.pushState({}, '', '/admin/login'); window.dispatchEvent(new PopStateEvent('popstate')) }}>Administrator sign in</button></footer>
    </div>
  )
}

function PatientHome({ session, mobileMenuOpen, setMobileMenuOpen, onNavigate, onBook, notice, onSignOut }) {
  const [activeTab, setActiveTab] = useState('doctors')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [clinics, setClinics] = useState([])
  const [doctors, setDoctors] = useState([])
  const [clinicPagination, setClinicPagination] = useState(null)
  const [doctorPagination, setDoctorPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [clinicSearch, setClinicSearch] = useState('')
  const [specialties, setSpecialties] = useState([])
  const [specialtyFilter, setSpecialtyFilter] = useState('')
  const [specialtyError, setSpecialtyError] = useState('')
  const [detailsDoctor, setDetailsDoctor] = useState(null)
  const [locationQuery, setLocationQuery] = useState('')
  const [locationPoint, setLocationPoint] = useState(null)
  const [radiusKm, setRadiusKm] = useState(20)
  const [locationError, setLocationError] = useState('')
  const [locating, setLocating] = useState(false)

  const useCurrentLocation = () => {
    setLocationError('')
    if (!navigator.geolocation) {
      setLocationError('Location access is not available in this browser.')
      return
    }

    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocationPoint({ latitude: coords.latitude, longitude: coords.longitude })
        setLocationQuery('')
        setPage(1)
        setLocating(false)
      },
      (geolocationError) => {
        const messages = {
          1: 'Allow location access in your browser to search nearby care.',
          2: 'Your location could not be determined. Try searching by city or area.',
          3: 'Location lookup timed out. Please try again.',
        }
        setLocationError(messages[geolocationError.code] || 'Unable to access your location.')
        setLocating(false)
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    )
  }

  useEffect(() => {
    api.get('/doctors/specialties')
      .then(({ data }) => {
        setSpecialties(data.data.specialties || [])
        setSpecialtyError('')
      })
      .catch((requestError) => setSpecialtyError(errorMessage(requestError)))
  }, [reloadKey])

  useEffect(() => {
    const controller = new AbortController()
    const fetchCatalog = async () => {
      setLoading(true)
      setError('')
      try {
        const locationParams = {}
        if (locationQuery.trim()) locationParams.location = locationQuery.trim()
        if (locationPoint) {
          locationParams.latitude = locationPoint.latitude
          locationParams.longitude = locationPoint.longitude
          locationParams.radiusKm = radiusKm
        }
        const clinicParams = {
          ...locationParams,
          page: activeTab === 'clinics' ? page : 1,
          limit: PAGE_SIZE,
        }
        const doctorParams = {
          ...locationParams,
          page: activeTab === 'doctors' ? page : 1,
          limit: PAGE_SIZE,
        }
        if (activeTab === 'doctors' && search.trim()) doctorParams.search = search.trim()
        if (activeTab === 'doctors' && specialtyFilter) doctorParams.specialty = specialtyFilter
        if (activeTab === 'clinics' && clinicSearch.trim()) clinicParams.search = clinicSearch.trim()
        const [clinicResponse, doctorResponse] = await Promise.all([
          api.get('/clinics/', { params: clinicParams, signal: controller.signal }),
          api.get('/doctors/', { params: doctorParams, signal: controller.signal }),
        ])
        setClinics(clinicResponse.data.data.clinics || [])
        setDoctors(doctorResponse.data.data.doctors || [])
        setClinicPagination(clinicResponse.data.pagination)
        setDoctorPagination(doctorResponse.data.pagination)
      } catch (requestError) {
        if (!axios.isCancel(requestError)) setError(errorMessage(requestError))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    const timer = window.setTimeout(fetchCatalog, 100)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [activeTab, page, search, clinicSearch, specialtyFilter, locationQuery, locationPoint, radiusKm, reloadKey])

  const items = activeTab === 'doctors' ? doctors : clinics
  const pagination = activeTab === 'doctors' ? doctorPagination : clinicPagination
  const changeTab = (next) => {
    setActiveTab(next)
    setPage(1)
    setSearch('')
    setClinicSearch('')
    setSpecialtyFilter('')
  }

  return (
    <div className="patient-home">
      {mobileMenuOpen && <button className="patient-mobile-backdrop" aria-label="Close menu" onClick={() => setMobileMenuOpen(false)} />}
      <header className="patient-public-header">
        <Brand onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />
        <nav className={`patient-public-nav ${mobileMenuOpen ? 'patient-public-nav-open' : ''}`} aria-label="Patient navigation">
          <button className="patient-public-nav-active" onClick={() => { changeTab('doctors'); document.getElementById('care-directory')?.scrollIntoView({ behavior: 'smooth' }); setMobileMenuOpen(false) }}>Find care</button>
          {session && <button onClick={() => { onNavigate('/dashboard'); setMobileMenuOpen(false) }}>My appointments</button>}
          <button onClick={() => { document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' }); setMobileMenuOpen(false) }}>How it works</button>
          <button className="mobile-only-nav" onClick={() => { onNavigate('/admin/login'); setMobileMenuOpen(false) }}>Administrator sign in</button>
        </nav>
        <div className="patient-header-actions">
          {session ? (
            <>
              <button className="patient-dashboard-link" onClick={() => onNavigate('/dashboard')}>My dashboard <ArrowRight size={15} /></button>
              <button className="patient-avatar-button" aria-label="Sign out" title="Sign out" onClick={onSignOut}><span>{initials(session.user.name)}</span><LogOut size={14} /></button>
            </>
          ) : (
            <>
              <button className="patient-signin-link" onClick={() => onNavigate('/login')}>Sign in</button>
              <button className="patient-header-cta" onClick={() => onNavigate('/register')}>Create account <ArrowRight size={15} /></button>
            </>
          )}
        </div>
        <button className="patient-menu-toggle" aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'} onClick={() => setMobileMenuOpen((open) => !open)}>{mobileMenuOpen ? <X size={21} /> : <Menu size={21} />}</button>
      </header>

      <main>
        <section className="patient-hero">
          <div className="patient-hero-content">
            <span className="patient-hero-kicker"><span /> CARE THAT CONNECTS</span>
            <h1>Feel better about<br />finding <em>care.</em></h1>
            <p>Meet trusted doctors, find a clinic that fits your life, and book your next visit with confidence.</p>
            <div className="patient-hero-actions"><button className="patient-primary-button" onClick={() => { changeTab('doctors'); document.getElementById('care-directory')?.scrollIntoView({ behavior: 'smooth' }) }}>Find a doctor <ArrowRight size={17} /></button><button className="patient-hero-secondary" onClick={() => { changeTab('clinics'); document.getElementById('care-directory')?.scrollIntoView({ behavior: 'smooth' }) }}>Explore clinics <MapPin size={16} /></button></div>
            <div className="patient-hero-trust"><span className="trust-avatars"><i>JM</i><i>AL</i><i>RK</i></span><span><strong>Care, made personal.</strong><small>Find the right provider for you.</small></span></div>
          </div>
          <div className="patient-hero-image">
            <img src="https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=1100&q=85" alt="Doctor ready to provide patient care" />
            <div className="patient-hero-image-shade" />
            <div className="hero-care-card"><span><HeartPulse size={18} /></span><div><strong>Care, on your terms</strong><small>Simple appointments. Trusted care.</small></div><Check size={16} /></div>
            <div className="hero-decoration hero-decoration-one" /><div className="hero-decoration hero-decoration-two" />
          </div>
          <div className="patient-hero-orb" />
        </section>

        <section id="care-directory" className="care-directory patient-enter">
          <div className="directory-heading">
            <div><span className="patient-eyebrow">YOUR NEXT STEP</span><h2>Find care that feels right</h2><p>Browse trusted doctors and clinics in your community.</p></div>
            <div className="directory-tabs" role="tablist" aria-label="Browse care">
              <button role="tab" aria-selected={activeTab === 'doctors'} className={activeTab === 'doctors' ? 'directory-tab-active' : ''} onClick={() => changeTab('doctors')}><Stethoscope size={16} /> Doctors</button>
              <button role="tab" aria-selected={activeTab === 'clinics'} className={activeTab === 'clinics' ? 'directory-tab-active' : ''} onClick={() => changeTab('clinics')}><HeartPulse size={16} /> Clinics</button>
            </div>
          </div>
          <div className="directory-toolbar">
            <label className="directory-search"><Search size={17} /><input aria-label={`Search ${activeTab}`} placeholder={activeTab === 'doctors' ? 'Search by doctor or specialty…' : 'Search clinics by name or city…'} value={activeTab === 'doctors' ? search : clinicSearch} onChange={(event) => { setPage(1); activeTab === 'doctors' ? setSearch(event.target.value) : setClinicSearch(event.target.value) }} /><kbd>⌘ K</kbd></label>
            {activeTab === 'doctors' && <label className="specialty-filter"><span>Specialty</span><select aria-label="Filter doctors by specialty" value={specialtyFilter} onChange={(event) => { setSpecialtyFilter(event.target.value); setPage(1) }}><option value="">All specialties</option>{specialties.map((specialty) => <option key={specialty._id} value={specialty.name}>{specialty.name}</option>)}</select><ChevronDown size={14} /></label>}
            {activeTab === 'doctors' && specialtyError && <span className="specialty-error" role="alert">{specialtyError} <button onClick={() => setReloadKey((key) => key + 1)}>Retry</button></span>}
            <span className="directory-count">{loading ? 'Finding care…' : pagination ? `${pagination.total} ${activeTab}` : ''}</span>
          </div>
          <div className="directory-location-row">
            <label className="directory-location-search"><MapPin size={17} /><input aria-label="Search by city, town or area" placeholder="City, town or area (e.g. Tenkasi)" value={locationQuery} onChange={(event) => { setLocationQuery(event.target.value); setLocationPoint(null); setLocationError(''); setPage(1) }} /></label>
            {locationPoint && <label className="directory-radius"><span>Within</span><input aria-label="Nearby search radius in kilometers" type="number" min="1" max="200" value={radiusKm} onChange={(event) => { setRadiusKm(Number(event.target.value) || 20); setPage(1) }} /><span>km</span></label>}
            <button type="button" className="location-button" onClick={useCurrentLocation} disabled={locating}>{locating ? 'Finding location…' : <><MapPin size={15} /> Use My Current Location</>}</button>
          </div>
          {locationError && <p className="location-search-error" role="alert">{locationError}</p>}
          {error ? (
            <div className="patient-directory-state"><span className="directory-state-icon"><X size={20} /></span><h3>We couldn’t load care options</h3><p>{error}</p><button className="patient-outline-button" onClick={() => setReloadKey((key) => key + 1)}>Try again</button></div>
          ) : loading ? (
            <div className="provider-grid">{Array.from({ length: 4 }, (_, index) => <ProviderSkeleton key={index} />)}</div>
          ) : items.length === 0 ? (
            <div className="patient-directory-state"><span className="directory-state-icon"><Search size={20} /></span><h3>No {activeTab} found</h3><p>Try a different search, or check back as our care network grows.</p></div>
          ) : (
            <div className="provider-grid">
              {items.map((item, index) => activeTab === 'doctors'
                ? <DoctorCard doctor={item} index={index} key={item.id || item._id} onBook={() => onBook(item)} onDetails={() => setDetailsDoctor(item)} />
                : <ClinicCard clinic={item} index={index} locationSearch={Boolean(locationQuery.trim() || locationPoint)} key={item.id || item._id} />)}
            </div>
          )}
          {pagination?.pages > 1 && <div className="patient-pagination"><span>Page {pagination.page} of {pagination.pages}</span><div><button aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={17} /></button><button aria-label="Next page" disabled={page >= pagination.pages} onClick={() => setPage((current) => current + 1)}><ChevronRight size={17} /></button></div></div>}
        </section>

        <section id="how-it-works" className="how-it-works">
          <div><span className="patient-eyebrow">CARE, SIMPLIFIED</span><h2>From search to care,<br />in a few simple steps.</h2><p>Your time matters. We make it easier to find care and keep everything together.</p></div>
          <div className="steps-grid">
            <StepCard number="01" icon={Search} title="Find your fit" description="Explore trusted doctors and clinics, all in one place." />
            <StepCard number="02" icon={CalendarPlus} title="Book with ease" description="Choose a time that works and request your appointment." />
            <StepCard number="03" icon={HeartPulse} title="Feel cared for" description="Keep your upcoming visits together in your patient dashboard." />
          </div>
        </section>
      </main>
      <PatientFooter onAdmin={() => onNavigate('/admin/login')} onDoctor={() => onNavigate('/doctor/login')} />
      {detailsDoctor && <DoctorDetailsModal doctor={detailsDoctor} onClose={() => setDetailsDoctor(null)} onBook={() => { setDetailsDoctor(null); onBook(detailsDoctor) }} />}
      {notice && <PatientToast>{notice}</PatientToast>}
    </div>
  )
}

function PatientDashboard({ session, onProfileUpdated, onBrowse, onSignOut, initialDoctor, onBookingClose, onBookingComplete, notice }) {
  const [appointments, setAppointments] = useState([])
  const [appointmentStats, setAppointmentStats] = useState(null)
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationError, setNotificationError] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileForm, setProfileForm] = useState({
    name: session.user.name || '',
    email: session.user.email || '',
    phone: session.user.phone || '',
  })
  const [profileError, setProfileError] = useState('')
  const [profileSubmitting, setProfileSubmitting] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    api.get('/appointments?page=1&limit=20', {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${session.token}` },
    }).then(({ data }) => {
      setAppointments(data.data.appointments || [])
      setAppointmentStats(data.data.stats || null)
      setPagination(data.pagination)
      setError('')
    }).catch((requestError) => {
      if (axios.isCancel(requestError)) return
      setError(errorMessage(requestError))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [session.token, reloadKey])

  useEffect(() => {
    const controller = new AbortController()
    api.get('/notifications', {
      params: { limit: 8 },
      signal: controller.signal,
      headers: { Authorization: `Bearer ${session.token}` },
    }).then(({ data }) => {
      setNotifications(data.data.notifications || [])
      setUnreadCount(data.data.unreadCount || 0)
      setNotificationError('')
    }).catch((requestError) => {
      if (!axios.isCancel(requestError)) setNotificationError(errorMessage(requestError))
    })
    return () => controller.abort()
  }, [session.token, reloadKey])

  const upcomingCount = appointmentStats?.upcoming ?? appointments.filter((appointment) =>
    appointment.status === 'confirmed' && new Date(appointment.startAt) >= new Date()
  ).length

  const markNotificationRead = async (notification) => {
    try {
      await api.patch(`/notifications/${notification._id}/read`, {}, {
        headers: { Authorization: `Bearer ${session.token}` },
      })
      setNotifications((items) => items.map((item) =>
        item._id === notification._id ? { ...item, readAt: item.readAt || new Date().toISOString() } : item
      ))
      if (!notification.readAt) setUnreadCount((count) => Math.max(0, count - 1))
    } catch (requestError) {
      setNotificationError(errorMessage(requestError))
    }
  }

  const markAllNotificationsRead = async () => {
    try {
      await api.patch('/notifications/read-all', {}, {
        headers: { Authorization: `Bearer ${session.token}` },
      })
      const readAt = new Date().toISOString()
      setNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt || readAt })))
      setUnreadCount(0)
    } catch (requestError) {
      setNotificationError(errorMessage(requestError))
    }
  }

  const cancelAppointment = async (appointment) => {
    if (!window.confirm('Cancel this appointment?')) return
    try {
      await api.patch(`/appointments/${appointment._id}/status`, { status: 'cancelled' }, {
        headers: { Authorization: `Bearer ${session.token}` },
      })
      setReloadKey((key) => key + 1)
    } catch (requestError) {
      setError(errorMessage(requestError))
    }

  }

  const completeBooking = () => {
    setReloadKey((key) => key + 1)
    onBookingComplete()
  }

  const saveProfile = async (event) => {
    event.preventDefault()
    setProfileError('')
    if (profileForm.name.trim().length < 2) {
      setProfileError('Enter your full name.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileForm.email.trim())) {
      setProfileError('Enter a valid email address.')
      return
    }
    setProfileSubmitting(true)
    try {
      const { data } = await api.patch('/auth/me/', {
        name: profileForm.name.trim(),
        email: profileForm.email.trim(),
        phone: profileForm.phone.trim(),
      }, {
        headers: { Authorization: `Bearer ${session.token}` },
      })
      onProfileUpdated(data.data.user)
      setProfileOpen(false)
    } catch (requestError) {
      setProfileError(errorMessage(requestError))
    } finally {
      setProfileSubmitting(false)
    }
  }

  return (
    <div className="patient-dashboard-page patient-enter">
      <header className="patient-public-header dashboard-header">
        <Brand onClick={onBrowse} />
        <nav className="patient-public-nav dashboard-public-nav"><button onClick={onBrowse}>Find care</button><button className="patient-public-nav-active">My appointments</button></nav>
        <div className="patient-header-actions"><span className="dashboard-welcome">Hello, {session.user.name.split(' ')[0]}</span><div className="patient-notifications"><button className="patient-notification-button" aria-label={`${unreadCount} unread notifications`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}><Bell size={18} />{unreadCount > 0 && <span>{unreadCount > 99 ? '99+' : unreadCount}</span>}</button>{notificationsOpen && <div className="patient-notification-panel"><div className="patient-notification-head"><strong>Notifications</strong><button disabled={!unreadCount} onClick={markAllNotificationsRead}>Mark all read</button></div>{notificationError ? <p role="alert">{notificationError}</p> : notifications.length ? notifications.map((notification) => <button key={notification._id} className={`patient-notification-item ${notification.readAt ? '' : 'patient-notification-unread'}`} onClick={() => !notification.readAt && markNotificationRead(notification)}><strong>{notification.title}</strong><span>{notification.message}</span><small>{formatDate(notification.createdAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small></button>) : <p>You’re all caught up.</p>}</div>}</div><button className="patient-avatar-button" onClick={onSignOut} title="Sign out" aria-label="Sign out"><span>{initials(session.user.name)}</span><LogOut size={14} /></button></div>
      </header>
      <main className="patient-dashboard-main">
        <div className="patient-dashboard-heading">
          <div><span className="patient-eyebrow">YOUR PATIENT PORTAL</span><h1>Your care, all in one place.</h1><p>Review upcoming visits and keep your health journey moving forward.</p></div>
          <div className="patient-dashboard-heading-actions"><button className="patient-outline-button" onClick={() => { setProfileForm({ name: session.user.name || '', email: session.user.email || '', phone: session.user.phone || '' }); setProfileError(''); setProfileOpen(true) }}>Edit profile</button><button className="patient-primary-button" onClick={onBrowse}>Find a doctor <ArrowRight size={16} /></button></div>
        </div>
        <div className="patient-summary-grid">
          <div className="patient-summary-card summary-next"><span className="summary-icon"><CalendarDays size={19} /></span><span className="summary-label">UPCOMING VISITS</span><strong>{loading ? '—' : upcomingCount}</strong><small>Confirmed appointments ahead</small></div>
          <div className="patient-summary-card"><span className="summary-icon summary-icon-blue"><HeartPulse size={19} /></span><span className="summary-label">TOTAL APPOINTMENTS</span><strong>{loading ? '—' : pagination?.total ?? appointments.length}</strong><small>Your care history with HealPoint</small></div>
          <div className="patient-summary-card"><span className="summary-icon summary-icon-violet"><ShieldCheck size={19} /></span><span className="summary-label">ACCOUNT STATUS</span><strong className="account-status">Active</strong><small>Your patient account is in good standing</small></div>
        </div>
        <section className="patient-appointments-card">
          <div className="patient-appointments-heading"><div><h2>Your appointments</h2><p>Upcoming visits and past care</p></div><span className="appointment-total">{pagination?.total || 0} total</span></div>
          {error && <div className="patient-dashboard-error" role="alert">{error}</div>}
          {loading ? <div className="patient-appointment-skeletons">{Array.from({ length: 3 }, (_, index) => <ProviderSkeleton key={index} compact />)}</div> : appointments.length === 0 ? (
            <div className="patient-appointment-empty"><span className="directory-state-icon"><CalendarDays size={20} /></span><h3>Your next chapter in care starts here</h3><p>No appointments yet. Find a trusted doctor and book a time that works for you.</p><button className="patient-primary-button" onClick={onBrowse}>Browse doctors <ArrowRight size={16} /></button></div>
          ) : (
            <div className="patient-appointment-list">{appointments.map((appointment) => <PatientAppointment key={appointment._id} appointment={appointment} onCancel={() => cancelAppointment(appointment)} />)}</div>
          )}
        </section>
        <div className="patient-dashboard-help"><ShieldCheck size={17} /><span>Your health information is private and only shared with your care team.</span></div>
      </main>
      <PatientFooter
        onAdmin={() => { window.history.pushState({}, '', '/admin/login'); window.dispatchEvent(new PopStateEvent('popstate')) }}
        onDoctor={() => { window.history.pushState({}, '', '/doctor/login'); window.dispatchEvent(new PopStateEvent('popstate')) }}
      />
      {profileOpen && <div className="patient-profile-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileOpen(false) }}>
        <section className="patient-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="patient-profile-title">
          <header><div><span className="patient-eyebrow">ACCOUNT DETAILS</span><h2 id="patient-profile-title">Edit your profile</h2></div><button type="button" className="patient-profile-close" aria-label="Close profile editor" onClick={() => setProfileOpen(false)}><X size={18} /></button></header>
          <form onSubmit={saveProfile}>
            <label>Full name<input autoComplete="name" value={profileForm.name} onChange={(event) => setProfileForm((current) => ({ ...current, name: event.target.value }))} maxLength={100} required /></label>
            <label>Email address<input type="email" autoComplete="email" value={profileForm.email} onChange={(event) => setProfileForm((current) => ({ ...current, email: event.target.value }))} required /></label>
            <label>Phone<input autoComplete="tel" value={profileForm.phone} onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value }))} maxLength={30} /></label>
            {profileError && <p className="patient-profile-error" role="alert">{profileError}</p>}
            <footer><button type="button" className="patient-outline-button" onClick={() => setProfileOpen(false)}>Cancel</button><button type="submit" className="patient-primary-button" disabled={profileSubmitting}>{profileSubmitting ? 'Saving…' : 'Save profile'}</button></footer>
          </form>
        </section>
      </div>}
      {initialDoctor && <BookingModal doctor={initialDoctor} token={session.token} onClose={onBookingClose} onComplete={completeBooking} />}
      {notice && <PatientToast>{notice}</PatientToast>}
    </div>
  )
}

function PatientAppointment({ appointment, onCancel }) {
  const doctorName = appointment.doctor?.user?.name || 'Your doctor'
  const appointmentDate = new Date(appointment.startAt)
  const history = appointment.statusHistory || []
  const latestStatusChange = history[history.length - 1]
  const location = appointment.branch || appointment.clinic
  return (
    <article className="patient-appointment-row">
      <div className="appointment-date-block"><strong>{formatDate(appointment.startAt, { day: '2-digit' })}</strong><span>{formatDate(appointment.startAt, { month: 'short' }).toUpperCase()}</span></div>
      <div className="patient-appointment-doctor"><span className="appointment-doctor-avatar">{initials(doctorName)}</span><div><strong>{doctorName}</strong><span>{appointment.doctor?.specialty?.name || 'Care provider'}</span><small>{location?.name || 'Clinic location'}{location?.city ? ` · ${location.city}` : ''}</small></div></div>
      <div className="patient-appointment-time"><Clock3 size={15} /><span>{formatDate(appointment.startAt, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}<small>IST · {appointment.durationMinutes || 30} min</small></span></div>
      <div className="patient-appointment-state"><span className={`patient-status patient-status-${appointment.status}`}>{appointment.status}</span><small>{latestStatusChange ? `Updated ${formatDate(latestStatusChange.changedAt, { month: 'short', day: 'numeric' })}` : 'Status'}</small>{history.length > 0 && <details className="appointment-history"><summary>Status history</summary><ul>{history.map((item, index) => <li key={`${item.changedAt}-${index}`}><strong>{item.from ? `${item.from} → ${item.to}` : item.to}</strong><span>{formatDate(item.changedAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} IST</span></li>)}</ul></details>}</div>
      <strong className="patient-appointment-fee">{appointment.consultationFeeInr == null ? '—' : `₹${Number(appointment.consultationFeeInr).toLocaleString('en-IN')}`}</strong>
      {appointment.status === 'confirmed' && appointmentDate >= new Date() && <button className="patient-cancel-button" onClick={onCancel}>Cancel</button>}
    </article>
  )
}

function BookingModal({ doctor, token, onClose, onComplete }) {
  const todayIst = getIstDateString(new Date())
  const [date, setDate] = useState(() => shiftCalendarDate(todayIst, 1))
  const [selectedAssociationId, setSelectedAssociationId] = useState(
    doctor.clinics?.[0]?.clinicDoctorId || ''
  )
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [reason, setReason] = useState('')
  const [associations, setAssociations] = useState([])
  const [loadingSlots, setLoadingSlots] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const doctorId = doctor.id || doctor._id
  const selectedAssociation = associations.find(
    (association) => String(association.clinicDoctorId) === String(selectedAssociationId)
  )

  useEffect(() => {
    const controller = new AbortController()
    const loadSlots = async () => {
      setLoadingSlots(true)
      setError('')
      setSelectedSlot(null)
      try {
        const { data } = await api.get(`/appointments/doctors/${doctorId}/slots`, {
          params: { date },
          signal: controller.signal,
        })
        const nextAssociations = data.data.associations || []
        setAssociations(nextAssociations)
        if (!nextAssociations.some((item) => String(item.clinicDoctorId) === String(selectedAssociationId))) {
          setSelectedAssociationId(String(nextAssociations[0]?.clinicDoctorId || ''))
        }
      } catch (requestError) {
        if (!axios.isCancel(requestError)) setError(errorMessage(requestError))
      } finally {
        if (!controller.signal.aborted) setLoadingSlots(false)
      }
    }
    const timer = window.setTimeout(loadSlots, 120)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [doctorId, date, reloadKey, selectedAssociationId])

  const book = async (event) => {
    event.preventDefault()
    if (!selectedSlot || !selectedAssociationId) {
      setError('Choose an available appointment time before continuing.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      await api.post('/appointments', {
        doctorId,
        clinicDoctorId: selectedAssociationId,
        startAt: selectedSlot.startAt,
        reason: reason.trim(),
      }, { headers: { Authorization: `Bearer ${token}` } })
      onComplete()
    } catch (requestError) {
      setError(errorMessage(requestError))
      if (requestError.response?.status === 409) setReloadKey((key) => key + 1)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="booking-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="booking-modal patient-enter" role="dialog" aria-modal="true" aria-labelledby="booking-title">
        <button className="booking-close" aria-label="Close booking dialog" onClick={onClose}><X size={19} /></button>
        <div className="booking-modal-icon"><CalendarPlus size={21} /></div>
        <span className="patient-eyebrow">YOUR NEXT STEP</span>
        <h2 id="booking-title">Book an appointment</h2>
        <p className="booking-intro">Choose a time to meet with your care provider.</p>
        <div className="booking-doctor"><span className="appointment-doctor-avatar">{initials(doctor.name || doctor.user?.name)}</span><div><strong>{doctor.name || doctor.user?.name}</strong><span>{doctor.specialty?.name || doctor.specialty || 'Care provider'}{doctor.qualification ? ` · ${doctor.qualification}` : ''}</span></div></div>
        <form className="booking-form" onSubmit={book}>
          <label htmlFor="appointment-date">Appointment date <span>India Standard Time</span></label>
          <input id="appointment-date" type="date" min={todayIst} value={date} onChange={(event) => setDate(event.target.value)} required />
          {associations.length > 1 && <>
            <label htmlFor="appointment-clinic">Clinic and branch</label>
            <div className="booking-time-wrap"><select id="appointment-clinic" value={selectedAssociationId} onChange={(event) => setSelectedAssociationId(event.target.value)}>{associations.map((association) => <option value={association.clinicDoctorId} key={association.clinicDoctorId}>{association.branch?.name || association.clinic?.name}{association.branch?.city || association.clinic?.city ? ` · ${association.branch?.city || association.clinic?.city}` : ''}</option>)}</select><ChevronDown size={16} /></div>
          </>}
          {selectedAssociation && <div className="booking-clinic-summary"><MapPin size={14} /><span><strong>{selectedAssociation.branch?.name || selectedAssociation.clinic?.name}</strong>{selectedAssociation.branch?.address || selectedAssociation.clinic?.address}{selectedAssociation.branch?.city || selectedAssociation.clinic?.city ? `, ${selectedAssociation.branch?.city || selectedAssociation.clinic?.city}` : ''}</span></div>}
          <label>Available appointment times <span>IST · {doctor.consultationDurationMinutes || 30} min</span></label>
          {loadingSlots ? <div className="booking-slot-loading"><span className="patient-button-spinner" /> Loading configured schedule…</div> : selectedAssociation?.slots?.length ? (
            <div className="booking-slot-grid" role="group" aria-label="Available appointment times">
              {selectedAssociation.slots.map((slot) => <button type="button" className={selectedSlot?.startAt === slot.startAt ? 'booking-slot-selected' : ''} key={slot.startAt} onClick={() => setSelectedSlot(slot)}>{slot.localTime}</button>)}
            </div>
          ) : <p className="booking-no-slots">No available times for this date. Try another date or clinic.</p>}
          {selectedSlot && <div className="booking-fee-summary"><span>Consultation fee</span><strong>₹{Number(selectedSlot.consultationFeeInr).toLocaleString('en-IN')}</strong></div>}
          <label htmlFor="appointment-reason">What would you like help with? <span>Optional</span></label>
          <textarea id="appointment-reason" maxLength={1000} rows={3} placeholder="Share a brief note for your care team" value={reason} onChange={(event) => setReason(event.target.value)} />
          {error && <div className="patient-form-error" role="alert">{error}</div>}
          <button type="submit" className="patient-primary-button booking-submit" disabled={submitting || loadingSlots || !selectedSlot}>
            {submitting ? <><span className="patient-button-spinner" /> Booking…</> : <>Confirm appointment <ArrowRight size={16} /></>}
          </button>
        </form>
        <div className="booking-secure"><ShieldCheck size={14} /> Your appointment details are private.</div>
      </section>
    </div>
  )
}

function DoctorCard({ doctor, index, onBook, onDetails }) {
  const name = doctor.name || doctor.user?.name || 'Care provider'
  const specialty = doctor.specialty?.name || doctor.specialty || 'General practice'
  const fee = doctor.consultationFeeInr ?? doctor.consultationFee
  return (
    <article className="provider-card" style={{ '--card-index': index }}>
      <div className="provider-card-top"><span className="provider-avatar">{doctor.profileImage ? <img src={doctor.profileImage} alt="" /> : <Stethoscope size={21} />}</span><span className="provider-open"><i /> Accepting patients</span></div>
      <h3>{name}</h3>
      <span className="provider-specialty">{specialty}</span>
      <p className="provider-qualification">{doctor.qualification || 'Experienced care provider'}{doctor.experienceYears != null ? ` · ${doctor.experienceYears} years’ experience` : ''}</p>
      {doctor.bio && <p className="provider-bio">{doctor.bio}</p>}
      <div className="provider-card-bottom"><span className="provider-fee">{fee == null ? 'Consultation' : `₹${Number(fee).toLocaleString('en-IN')}`}<small>{fee == null ? 'Book a visit' : 'consultation'}</small></span><div className="provider-card-actions"><button className="provider-details-button" onClick={onDetails}>Details</button><button className="provider-book-button" onClick={onBook}>Book visit <ArrowRight size={15} /></button></div></div>
      {doctor.clinics?.length > 0 && <span className="provider-location"><MapPin size={13} /> {doctor.clinics.slice(0, 2).map((clinic) => `${clinic.branch?.name || clinic.name} · ${[clinic.branch?.address || clinic.address, clinic.branch?.city || clinic.city].filter(Boolean).join(', ')}${formatDistance(clinic.distanceKm) ? ` · ${formatDistance(clinic.distanceKm)}` : ''}`).join(' | ')}</span>}
    </article>
  )
}

function DoctorDetailsModal({ doctor, onClose, onBook }) {
  const name = doctor.name || doctor.user?.name || 'Care provider'
  const specialty = doctor.specialty?.name || doctor.specialty || 'General practice'
  const fee = doctor.consultationFeeInr ?? doctor.consultationFee
  return (
    <div className="booking-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="doctor-details-modal patient-enter" role="dialog" aria-modal="true" aria-labelledby="doctor-details-title">
        <button className="booking-close" aria-label="Close doctor details" onClick={onClose}><X size={19} /></button>
        <div className="doctor-details-header">
          <span className="doctor-details-avatar">{doctor.profileImage ? <img src={doctor.profileImage} alt="" /> : <Stethoscope size={24} />}</span>
          <div><span className="provider-specialty">{specialty}</span><h2 id="doctor-details-title">{name}</h2><p>{doctor.qualification || 'Qualifications not listed'}{doctor.experienceYears != null ? ` · ${doctor.experienceYears} years’ experience` : ''}</p></div>
        </div>
        {doctor.bio && <p className="doctor-details-bio">{doctor.bio}</p>}
        <div className="doctor-details-facts">
          <div><span>Consultation fee</span><strong>{fee == null ? 'Contact clinic' : `₹${Number(fee).toLocaleString('en-IN')}`}</strong></div>
          <div><span>Appointment length</span><strong>{doctor.consultationDurationMinutes || 30} minutes</strong></div>
          <div><span>Languages</span><strong>{doctor.languagesSpoken?.length ? doctor.languagesSpoken.join(', ') : 'Not listed'}</strong></div>
        </div>
        <div className="doctor-details-clinics">
          <h3>Clinics and visiting hours</h3>
          {doctor.clinics?.length ? doctor.clinics.map((clinic) => (
            <article key={clinic.clinicDoctorId}>
              <strong>{clinic.branch?.name || clinic.name}</strong>
              <span>{[clinic.branch?.address || clinic.address, clinic.branch?.city || clinic.city, clinic.branch?.state || clinic.state].filter(Boolean).join(', ')}</span>
              <small>{scheduleLabel(clinic.weeklySchedule) || 'Schedule not configured'} · India Standard Time</small>
            </article>
          )) : <p>Clinic schedule is not currently listed.</p>}
        </div>
        <button className="patient-primary-button doctor-details-book" onClick={onBook}>View available times <CalendarPlus size={16} /></button>
      </section>
    </div>
  )
}

function ClinicCard({ clinic, index, locationSearch }) {
  const nearestBranch = clinic.branches?.reduce((nearest, branch) =>
    !nearest ||
    (branch.distanceKm !== null &&
      branch.distanceKm !== undefined &&
      (nearest.distanceKm === null ||
        nearest.distanceKm === undefined ||
        branch.distanceKm < nearest.distanceKm))
      ? branch
      : nearest, null)
  const showBranch = locationSearch && Boolean(nearestBranch) && (
    !clinic.location ||
    clinic.distanceKm == null ||
    (nearestBranch.distanceKm != null && nearestBranch.distanceKm <= clinic.distanceKm)
  )
  const locationName = showBranch ? nearestBranch.name : clinic.name
  const locationAddress = showBranch ? nearestBranch.address : clinic.address
  const locationCity = showBranch ? nearestBranch.city : clinic.city
  const locationState = showBranch ? nearestBranch.state : clinic.state
  return (
    <article className="provider-card clinic-card" style={{ '--card-index': index }}>
      <div className="provider-card-top"><span className="provider-avatar clinic-provider-avatar"><HeartPulse size={22} /></span><span className="provider-open"><i /> Open for care</span></div>
      <h3>{clinic.name}</h3>
      <span className="provider-specialty">{showBranch ? `${locationName} · ` : ''}{locationCity || clinic.city}{locationState ? `, ${locationState}` : ''}</span>
      <p className="clinic-address"><MapPin size={14} /> {locationAddress || 'Address available upon request'}</p>
      {formatDistance(clinic.distanceKm) && <span className="provider-location"><MapPin size={13} /> {formatDistance(clinic.distanceKm)}</span>}
      <p className="provider-qualification clinic-description">{clinic.description || `${clinic.branches?.length || 0} care locations serving your community.`}</p>
      <div className="provider-card-bottom"><span className="clinic-contact"><strong>{clinic.phone || 'Contact clinic'}</strong><small>{clinic.branches?.length || 0} locations</small></span><a className="provider-book-button clinic-contact-button" href={`mailto:${encodeURIComponent(clinic.email || '')}`}>Contact <ArrowRight size={15} /></a></div>
    </article>
  )
}

function ProviderSkeleton({ compact = false }) {
  return <div className={`provider-skeleton ${compact ? 'provider-skeleton-compact' : ''}`} aria-label="Loading care options"><span /><i /><i /><i /></div>
}

function StepCard({ number, icon: Icon, title, description }) {
  return <article className="care-step"><span className="care-step-number">{number}</span><span className="care-step-icon"><Icon size={20} /></span><h3>{title}</h3><p>{description}</p></article>
}

function Brand({ onClick }) {
  return <button className="patient-brand" onClick={onClick}><span className="patient-brand-mark"><HeartPulse size={22} /></span><span>healpoint</span></button>
}

function PatientFooter({ onAdmin, onDoctor }) {
  return <footer className="patient-footer"><Brand onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} /><span>© 2025 HealPoint Health Systems</span><div><ShieldCheck size={14} /> Care, handled with care.</div><button onClick={onDoctor}>Doctor sign in</button><button onClick={onAdmin}>Administrator sign in</button></footer>
}

function PatientToast({ children }) {
  return <div className="patient-toast" role="status"><span><Check size={15} /></span>{children}</div>
}
