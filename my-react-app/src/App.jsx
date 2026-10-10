import { useEffect, useMemo, useRef, useState } from 'react'
import Login from './Login.jsx'
import AdminPage from './AdminPage.jsx'
import './Role.css'
import './App.css'

const initialCases = [
  { id: 'SD-2048', title: 'Laptop access for new team member', requester: 'Priya Sharma', email: 'priya.sharma@acme.io', category: 'Hardware', priority: 'High', status: 'Awaiting approval', team: 'IT Operations', created: 'Today, 10:42 AM', description: 'A new design team member needs a company laptop configured with the approved design tools.', missing: '', needsApproval: true, actionDone: false, logs: [{ time: '10:42 AM', text: 'Request received and classified as Hardware.', type: 'info' }, { time: '10:43 AM', text: 'Routed to IT Operations. Manager approval required.', type: 'success' }] },
  { id: 'SD-2047', title: 'Reset account password', requester: 'Marcus Lee', email: 'marcus.lee@acme.io', category: 'Account access', priority: 'Medium', status: 'In progress', team: 'Identity & Access', created: 'Today, 10:18 AM', description: 'Unable to sign in after a password change. Please help restore access.', missing: '', needsApproval: false, actionDone: false, logs: [{ time: '10:18 AM', text: 'Request received and classified as Account access.', type: 'info' }, { time: '10:19 AM', text: 'Identity check started.', type: 'success' }, { time: '10:20 AM', text: 'Mock identity API timed out. Safe to retry.', type: 'warning' }] },
  { id: 'SD-2046', title: 'Install analytics software', requester: 'Nina Patel', email: 'nina.patel@acme.io', category: 'Software', priority: 'Low', status: 'Needs information', team: 'Business Systems', created: 'Today, 9:56 AM', description: 'Please install the analytics application on my workstation.', missing: 'Please specify the application name and your device ID.', needsApproval: false, actionDone: false, logs: [{ time: '9:56 AM', text: 'Request received and classified as Software.', type: 'info' }, { time: '9:57 AM', text: 'Missing required details. Follow-up requested.', type: 'warning' }] },
  { id: 'SD-2045', title: 'VPN access for remote work', requester: 'Jordan Kim', email: 'jordan.kim@acme.io', category: 'Account access', priority: 'Medium', status: 'Completed', team: 'Identity & Access', created: 'Today, 9:31 AM', description: 'Enable the standard VPN profile for my approved remote work setup.', missing: '', needsApproval: false, actionDone: true, logs: [{ time: '9:31 AM', text: 'Request received and classified as Account access.', type: 'info' }, { time: '9:33 AM', text: 'Policy check passed. Request routed to Identity & Access.', type: 'success' }, { time: '9:35 AM', text: 'VPN access provisioned successfully.', type: 'success' }] },
]

const statusClass = (status) => ({ Requested: 'requested', Ongoing: 'progress', 'Awaiting approval': 'approval', 'In progress': 'progress', 'Needs information': 'needs', Completed: 'complete', Escalated: 'escalated', Failed: 'failed', 'Waiting to sync': 'requested' }[status] || 'progress')
const timeNow = () => new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date())
const offlineQueueKey = (userId) => `innovate-x-offline-requests:${userId}`
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
function readOfflineQueue(userId) {
  try { return JSON.parse(localStorage.getItem(offlineQueueKey(userId)) || '[]') }
  catch { return [] }
}
async function api(path, options = {}) {
  const token = sessionStorage.getItem('innovate-x-demo-token')
  const response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...options.headers } })
  const result = await response.json()
  if (!response.ok) {
    const error = new Error(result.error || 'The server could not complete that request.')
    error.status = response.status
    error.details = result
    throw error
  }
  return result
}

function RequestActionsMenu({ item, open, onToggle, onView, onDelete, className = 'row-more' }) {
  return <div className="request-menu-wrap">
    <button type="button" className={className} aria-label={`Actions for ${item.id}`} aria-expanded={open} onClick={(event) => { event.stopPropagation(); onToggle() }}>···</button>
    {open && <div className="request-action-menu" role="menu" onClick={(event) => event.stopPropagation()}>
      <button type="button" role="menuitem" onClick={onView}>View details</button>
      <button type="button" role="menuitem" className="delete-request-option" onClick={onDelete}>Delete request</button>
    </div>}
  </div>
}

function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      if (!sessionStorage.getItem('innovate-x-demo-token')) { sessionStorage.removeItem('innovate-x-demo-user'); return null }
      return JSON.parse(sessionStorage.getItem('innovate-x-demo-user'))
    } catch { return null }
  })
  const [cases, setCases] = useState([])
  const casesRef = useRef([])
  const syncingOfflineQueue = useRef(false)
  const [offlineQueueOwner, setOfflineQueueOwner] = useState(null)
  const [pendingRequests, setPendingRequests] = useState([])
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const requestsPanelRef = useRef(null)
  const [selectedId, setSelectedId] = useState(null)
  const [openMenuId, setOpenMenuId] = useState(null)
  const [deletingCaseId, setDeletingCaseId] = useState(null)
  const [filter, setFilter] = useState('All requests')
  const [query, setQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [formError, setFormError] = useState('')
  const [submittingRequest, setSubmittingRequest] = useState(false)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const offlineCaseRows = currentUser?.role === 'requester' ? pendingRequests.map((pending) => ({
    ...pending.body,
    id: pending.localId,
    requester: currentUser.name,
    email: currentUser.email,
    department: currentUser.department || pending.body.department || '',
    category: pending.body.networkUnavailable ? 'Network issue · offline default' : 'Pending AI classification',
    status: 'Waiting to sync',
    team: 'Will be assigned after sync',
    assignedWorkerName: 'Will be assigned after sync',
    created: `Saved on this device · ${pending.queuedAt}`,
    description: pending.body.description,
    logs: [{ time: pending.queuedAt, text: 'Saved on this device. It will be classified and routed after the connection returns.', type: 'warning' }],
    offlineQueued: true,
  })) : []
  const workspaceCases = currentUser?.role === 'requester' ? [...offlineCaseRows, ...cases.filter((item) => item.requester.toLowerCase() === currentUser.name.toLowerCase())] : cases
  const selected = workspaceCases.find((item) => item.id === selectedId) || workspaceCases[0]

  useEffect(() => { casesRef.current = cases }, [cases])
  useEffect(() => {
    if (!currentUser || currentUser.role !== 'requester') { setOfflineQueueOwner(null); setPendingRequests([]); return }
    setPendingRequests(readOfflineQueue(currentUser.id))
    setOfflineQueueOwner(currentUser.id)
  }, [currentUser])
  useEffect(() => {
    if (!currentUser || currentUser.role !== 'requester' || offlineQueueOwner !== currentUser.id) return
    try { localStorage.setItem(offlineQueueKey(currentUser.id), JSON.stringify(pendingRequests)) }
    catch { setNotice('The browser could not save this request offline. Check available device storage and try again.') }
  }, [currentUser, offlineQueueOwner, pendingRequests])
  useEffect(() => {
    const updateOnline = () => setIsOnline(navigator.onLine)
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    return () => {
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
    }
  }, [])
  useEffect(() => {
    if (!openMenuId) return undefined
    const closeMenu = () => setOpenMenuId(null)
    document.addEventListener('click', closeMenu)
    return () => document.removeEventListener('click', closeMenu)
  }, [openMenuId])

  useEffect(() => {
    if (!currentUser || currentUser.role === 'admin') { setLoading(false); return }
    setLoading(true)
    api('/api/requests').then((items) => {
      setCases(items)
      setSelectedId(items[0]?.id || null)
      setLoading(false)
    }).catch((error) => {
      setNotice(`Could not connect to backend: ${error.message}. Start the app with npm run dev.`)
      setLoading(false)
    })
  }, [currentUser])
  useEffect(() => {
    if (!['team', 'requester'].includes(currentUser?.role)) return
    let active = true
    const refreshTeamQueue = async () => {
      try {
        const items = await api('/api/requests')
        const currentIds = new Set(casesRef.current.map((item) => item.id))
        const newCount = currentUser.role === 'team' ? items.filter((item) => !currentIds.has(item.id)).length : 0
        const changedRequesterCase = currentUser.role === 'requester' && items.find((item) => {
          const previous = casesRef.current.find((existing) => existing.id === item.id)
          return previous && previous.status !== item.status
        })
        if (!active) return
        if (newCount > 0) setNotice(`${newCount} new request${newCount === 1 ? '' : 's'} for your department.`)
        else if (changedRequesterCase) setNotice(`Worker update: ${changedRequesterCase.id} is now “${changedRequesterCase.status}”.`)
        casesRef.current = items
        setCases(items)
      } catch { /* Keep the last loaded queue visible during temporary connection issues. */ }
    }
    window.addEventListener('online', refreshTeamQueue)
    const timer = setInterval(refreshTeamQueue, 5000)
    return () => { active = false; clearInterval(timer); window.removeEventListener('online', refreshTeamQueue) }
  }, [currentUser])
  useEffect(() => {
    if (currentUser?.role !== 'requester' || pendingRequests.length === 0 || syncingOfflineQueue.current) return
    let active = true
    syncingOfflineQueue.current = true
    const syncPendingRequests = async () => {
      let queue = readOfflineQueue(currentUser.id)
      let synced = 0
      for (const pending of queue) {
        if (!active) break
        try {
          const entry = await api('/api/requests', { method: 'POST', body: JSON.stringify(pending.body) })
          if (!active) break
          queue = queue.filter((item) => item.clientRequestId !== pending.clientRequestId)
          setCases((items) => [entry, ...items.filter((item) => item.id !== entry.id)])
          setSelectedId(entry.id)
          synced += 1
        } catch (error) {
          if (!error.status) break
          setNotice(`Saved request ${pending.localId} could not sync: ${error.message}`)
          break
        }
      }
      if (active) {
        localStorage.setItem(offlineQueueKey(currentUser.id), JSON.stringify(queue))
        setPendingRequests(queue)
        if (synced > 0) setNotice(`${synced} offline request${synced === 1 ? '' : 's'} sent. Category and department worker assignment are now confirmed.`)
      }
      syncingOfflineQueue.current = false
    }
    syncPendingRequests().catch(() => { syncingOfflineQueue.current = false })
    const retryTimer = setInterval(() => syncPendingRequests().catch(() => { syncingOfflineQueue.current = false }), 5000)
    return () => { active = false; syncingOfflineQueue.current = false; clearInterval(retryTimer) }
  }, [currentUser, isOnline, pendingRequests])
  const visibleCases = useMemo(() => workspaceCases.filter((item) => {
    const matchesFilter = filter === 'All requests' || (filter === 'Awaiting requests' ? !['Completed', 'Escalated'].includes(item.status) : filter === 'Ongoing' ? ['Ongoing', 'In progress'].includes(item.status) : item.status === filter)
    const term = query.trim().toLowerCase()
    return matchesFilter && (!term || `${item.id} ${item.title} ${item.requester} ${item.category}`.toLowerCase().includes(term))
  }), [workspaceCases, filter, query])
  const counts = { open: workspaceCases.filter((item) => !['Completed', 'Escalated'].includes(item.status)).length, approval: workspaceCases.filter((item) => item.status === 'Awaiting approval').length, done: workspaceCases.filter((item) => item.status === 'Completed').length }

  function signIn(account, token) {
    sessionStorage.setItem('innovate-x-demo-user', JSON.stringify(account))
    sessionStorage.setItem('innovate-x-demo-token', token)
    setCurrentUser(account)
    setFilter('All requests')
  }
  function signOut() {
    const token = sessionStorage.getItem('innovate-x-demo-token')
    if (token) fetch(`${apiBaseUrl}/api/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => {})
    sessionStorage.removeItem('innovate-x-demo-user')
    sessionStorage.removeItem('innovate-x-demo-token')
    setCurrentUser(null)
    setSelectedId(null)
  }
  function updateCurrentUser(account) {
    sessionStorage.setItem('innovate-x-demo-user', JSON.stringify(account))
    setCurrentUser(account)
  }

  function replaceCase(updated) {
    setCases((current) => current.map((item) => item.id === updated.id ? updated : item))
  }
  async function createCase(event) {
    event.preventDefault()
    if (submittingRequest) return
    const form = event.currentTarget
    const data = new FormData(form)
    const body = Object.fromEntries(data.entries())
    if (currentUser?.role === 'requester') {
      body.requester = currentUser.name
      body.email = currentUser.email
      body.networkUnavailable = !navigator.onLine
    }
    const clientRequestId = crypto.randomUUID()
    body.clientRequestId = clientRequestId
    setFormError('')
    setSubmittingRequest(true)
    try {
      const entry = await api('/api/requests', { method: 'POST', body: JSON.stringify(body) })
      form.reset()
      setCases((current) => [entry, ...current]); setSelectedId(entry.id); setShowForm(false); setFilter('All requests'); setNotice(`Request created. Category: ${entry.category}. Assigned to worker ${entry.assignedWorkerName}. Status: ${entry.status}.`)
    } catch (error) {
      if (currentUser?.role === 'requester' && !error.status) {
        body.networkUnavailable = true
        const pending = { localId: `LOCAL-${clientRequestId.slice(0, 8)}`, clientRequestId, body, queuedAt: timeNow() }
        const queue = [...readOfflineQueue(currentUser.id).filter((item) => item.clientRequestId !== clientRequestId), pending]
        try {
          localStorage.setItem(offlineQueueKey(currentUser.id), JSON.stringify(queue))
          form.reset()
          setPendingRequests(queue)
          setSelectedId(pending.localId)
          setShowForm(false)
          setFilter('All requests')
          setNotice('No connection: your request is saved on this device and will be classified and sent to the matching department worker when service returns.')
          return
        } catch {
          setFormError('Offline storage is unavailable. Keep this page open and reconnect before sending the request.')
          return
        }
      }
      if (error.message.startsWith('Possible duplicate:')) {
        const found = cases.find((item) => error.message.includes(item.id))
        if (found) setSelectedId(found.id)
      }
      setFormError(error.message)
    } finally { setSubmittingRequest(false) }
  }
  async function doAction(operation, successText) {
    try {
      const updated = await api(`/api/requests/${selected.id}/${operation}`, { method: 'POST' })
      replaceCase(updated)
      setNotice(updated.status === 'Failed' ? 'Mock API failed safely. Use Retry action to recover.' : successText)
    } catch (error) { setNotice(error.message) }
  }
  async function deleteCase(item) {
    if (deletingCaseId) return
    if (item.offlineQueued) {
      const queue = pendingRequests.filter((pending) => pending.localId !== item.id)
      localStorage.setItem(offlineQueueKey(currentUser.id), JSON.stringify(queue))
      setPendingRequests(queue)
      if (selectedId === item.id) setSelectedId(null)
      setNotice('The unsent offline request was removed from this device.')
      return
    }
    if (!window.confirm(`Permanently delete request ${item.id} — “${item.title}”? This also removes its activity history.`)) return
    setDeletingCaseId(item.id)
    setNotice('')
    try {
      await api(`/api/requests/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
      const remaining = cases.filter((entry) => entry.id !== item.id)
      setCases(remaining)
      if (selectedId === item.id) setSelectedId(remaining[0]?.id || null)
      setOpenMenuId(null)
      setNotice(`Request ${item.id} was deleted.`)
    } catch (error) { setNotice(error.message) }
    finally { setDeletingCaseId(null) }
  }
  function approveCase() { return doAction('approve', 'Approved. The mock action completed successfully.') }
  function markOngoing() { return doAction('ongoing', 'Request marked as ongoing. The requester will see the updated status.') }
  function runMockAction() { return doAction('action', 'Action completed. The audit trail has been updated.') }
  function retryAction() { return doAction('retry', 'Retry succeeded and the case is complete.') }

  if (!currentUser) return <Login onLogin={signIn} />
  if (currentUser.role === 'admin') return <AdminPage user={currentUser} onSignOut={signOut} onUpdateUser={updateCurrentUser} />

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><img src="/innovate-x-mark.png" alt="Innovate X N logo" /></div><div><b>INNOVATE <em>X</em></b><small>WORKPLACE OPS</small></div></div>
        <div className="workspace"><div className="workspace-icon">I</div><div><b>Innovate X</b><small>Service workspace</small></div><span className="chevron">⌄</span></div>
        <div className="side-label">WORKSPACE</div>
        <nav className="nav-list"><button className="nav-item active"><span>▦</span> Overview</button><button className="nav-item" onClick={() => { setFilter('All requests'); requestsPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}><span>▤</span> Requests <i>{workspaceCases.length}</i></button>{currentUser.role === 'team' && <button className="nav-item" onClick={() => setFilter('Awaiting approval')}><span>◷</span> Approvals {counts.approval > 0 && <i className="count-orange">{counts.approval}</i>}</button>}</nav>
        {currentUser.role === 'team' && <><div className="side-label side-label-spaced">MANAGE</div><nav className="nav-list"><button className="nav-item"><span>◉</span> Teams</button><button className="nav-item"><span>⚙</span> Settings</button></nav></>}
        <div className="help-card"><div className="help-icon">?</div><b>InnovateX Management</b><p>Respected Person<br/>For support?<br/>Contact: <a href="tel:8825754596">8825754596</a></p></div><div className="sidebar-bottom"><div className="profile"><div className="avatar avatar-purple">{currentUser.name.split(' ').map((word) => word[0]).join('')}</div><div><b>{currentUser.name}</b><small>{currentUser.role === 'team' ? 'Service desk worker' : currentUser.requesterType === 'other_staff' ? 'Other staff' : `${currentUser.requesterType === 'teaching_staff' ? 'Teaching staff' : 'Student'} · ${currentUser.department}`}</small></div><button className="signout-button" onClick={signOut} title="Sign out">↪</button></div></div>
      </aside>

      <main className="main-area">
        <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <b>{currentUser.role === 'team' ? 'Worker dashboard' : 'Requester portal'}</b></div><div className="top-actions"><button className="icon-button" aria-label="Notifications">♧<em /></button><button className="top-signout" onClick={signOut} aria-label="Sign out of Innovate X"><span>↪</span> Sign out</button><div className="avatar avatar-purple top-avatar">{currentUser.name.split(' ').map((word) => word[0]).join('')}</div></div></header>
        <div className="content-wrap">
          <div className="welcome-row"><div><div className="eyebrow"><span className="live-dot" /> SERVICE DESK <span className="eyebrow-divider">/</span> THURSDAY, OCTOBER 9</div><h1>{currentUser.role === 'requester' ? 'Welcome back' : 'Good morning'}, {currentUser.name}</h1><p className="welcome-sub">{currentUser.role === 'requester' ? 'Track your requests and send new ones to the right team.' : 'Here’s what’s happening across your service desk today.'}</p></div>{currentUser.role === 'requester' && <button className="primary-button" onClick={() => { setShowForm(true); setFormError(''); setNotice('') }}><span>＋</span> New request</button>}</div>
          {!isOnline && <div className="notice offline-notice" role="status"><span>●</span>Internet connection not detected. The app will still try to reach the service desk over your local Wi‑Fi/LAN.</div>}
          {notice && <div className="notice"><span>✓</span>{notice}<button onClick={() => setNotice('')}>×</button></div>}
          {currentUser.role === 'requester' && showForm && <div className="request-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowForm(false) }}><form className="new-request-card request-modal" onSubmit={createCase}><div className="form-heading"><div><span className="section-kicker">REQUEST INTAKE</span><h2>Create a service request</h2></div><button type="button" className="icon-button" onClick={() => setShowForm(false)}>×</button></div><div className="form-grid"><label>Request title<input name="title" required placeholder="e.g. Set up access for a new starter" /></label>{currentUser.role === 'team' ? <><label>Requester name<input name="requester" required placeholder="Full name" /></label><label>Email <span className="optional">(optional)</span><input name="email" type="email" placeholder="name@company.com" /></label></> : <div className="requester-self"><span>REQUESTING AS</span><b>{currentUser.name}</b><small>{currentUser.email}</small></div>}{currentUser.role === 'requester' && (currentUser.department ? <label>Department · auto-assigned<input value={currentUser.department} disabled /><small>Your request will go to the matching department team.</small></label> : currentUser.requesterType === 'other_staff' ? <label>Department for routing<select name="department" defaultValue="" required><option value="">Choose department</option><option>CSE</option><option>IT</option><option>BIO-TECH</option><option>BIO-MEDICAL</option><option>CIVIL</option><option>MECH</option><option>AIDS</option><option>B.Ed</option><option>ECE</option><option>EEE</option></select></label> : <div className="department-warning" role="status">Your account has no department assigned. Ask the administrator to add your department; requests will then route automatically.</div>)}<label>Priority<select name="priority"><option>Medium</option><option>Low</option><option>High</option></select></label><label className="wide-field">Describe the issue for accurate AI category selection<textarea name="description" required minLength="10" rows="3" placeholder="For example: My CPU does not start, and its power light is off." /></label></div>{formError && <div className="request-form-error" role="alert">{formError}</div>}<div className="form-footer"><span>The issue category is automatically classified from your title and description. Department routing uses your account.</span><button className="primary-button" type="submit" disabled={(!currentUser.department && currentUser.requesterType !== 'other_staff') || submittingRequest}>{submittingRequest ? 'Classifying and creating…' : 'Create request →'}</button></div></form></div>}

          <section className="stats-grid"><article className="stat-card"><div className="stat-top"><span className="stat-icon violet">▤</span><span className="stat-trend">↗ 12%</span></div><div className="stat-number">{counts.open}</div><div className="stat-label">Open requests <span className="muted-inline">vs. last week</span></div><div className="mini-bars" aria-hidden="true"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div></article><article className="stat-card"><div className="stat-top"><span className="stat-icon amber">◷</span><span className="stat-period">Needs your attention</span></div><div className="stat-number">{counts.approval}</div><div className="stat-label">Awaiting approval</div><div className="stat-note"><span className="small-orange-dot"/> Review to keep things moving</div></article><article className="stat-card"><div className="stat-top"><span className="stat-icon green">✓</span><span className="stat-trend green-trend">+ 8 this week</span></div><div className="stat-number">{counts.done}</div><div className="stat-label">Resolved today</div><div className="progress-track"><span style={{ width: `${Math.min(100, 30 + counts.done * 15)}%` }} /></div></article><article className="stat-card"><div className="stat-top"><span className="stat-icon blue">◷</span><span className="stat-period">Average this week</span></div><div className="stat-number">2.4<span className="stat-unit"> hrs</span></div><div className="stat-label">Avg. resolution time</div><div className="stat-note muted-note">↓ 18% from last week</div></article></section>

          <section className="requests-panel" ref={requestsPanelRef}><div className="panel-heading"><div><div className="section-kicker">{currentUser.role === 'team' ? 'LIVE QUEUE' : 'YOUR REQUESTS'}</div><h2>Recent requests <span className="total-pill">{workspaceCases.length}</span></h2></div><button className="text-button" onClick={() => setNotice(currentUser.role === 'team' ? 'Showing all requests in the queue.' : 'Showing your requests.')}>View all requests <span>→</span></button></div><div className="table-toolbar"><div className="filter-tabs">{['All requests', ...(currentUser.role === 'requester' ? ['Awaiting requests'] : ['Requested', 'Ongoing', 'Awaiting approval']), 'Completed'].map((name) => <button key={name} onClick={() => setFilter(name)} className={filter === name ? 'selected' : ''}>{name}{name === 'All requests' && <span>{workspaceCases.length}</span>}{name === 'Awaiting requests' && <span>{workspaceCases.filter((item) => !['Completed', 'Escalated'].includes(item.status)).length}</span>}</button>)}</div><label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search requests..." /></label><button className="filter-button" onClick={() => setNotice('Use the tabs above to filter by request status.')}>☷ <span>Filter</span></button></div>
            <div className="table-scroll"><table><thead><tr><th>REQUEST</th><th>REQUESTER</th><th>CATEGORY</th><th>PRIORITY</th><th>STATUS</th><th>CREATED</th><th></th></tr></thead><tbody>{visibleCases.map((item) => <tr key={item.id} onClick={() => { setSelectedId(item.id); setOpenMenuId(null) }} className={selectedId === item.id ? 'row-selected' : ''}><td><div className="request-cell"><span className={`category-icon ${item.category === 'Hardware' ? 'cat-hardware' : item.category === 'Software' ? 'cat-software' : 'cat-access'}`}>{item.category === 'Hardware' ? '⌘' : item.category === 'Software' ? '▱' : '◇'}</span><div><b>{item.title}</b><small>{item.id}</small></div></div></td><td><div className="person-cell"><div className={`avatar ${item.requester === 'Priya Sharma' ? 'avatar-peach' : item.requester === 'Marcus Lee' ? 'avatar-blue' : item.requester === 'Nina Patel' ? 'avatar-green' : 'avatar-lilac'}`}>{item.requester.split(' ').map((word) => word[0]).join('')}</div><span>{item.requester}</span></div></td><td><span className="category-label">{item.category}</span></td><td><span className={`priority ${item.priority.toLowerCase()}`}><i />{item.priority}</span></td><td><span className={`status-badge ${statusClass(item.status)}`}><i />{item.status}</span></td><td className="date-cell">{item.created}</td><td><RequestActionsMenu item={item} open={openMenuId === item.id} onToggle={() => { setSelectedId(item.id); setOpenMenuId(openMenuId === item.id ? null : item.id) }} onView={() => { setSelectedId(item.id); setOpenMenuId(null) }} onDelete={() => deleteCase(item)} /></td></tr>)}</tbody></table>{visibleCases.length === 0 && <div className="empty-state">No requests match your search.</div>}</div>
            <div className="table-footer"><span>Showing <b>{visibleCases.length ? 1 : 0}–{visibleCases.length}</b> of <b>{workspaceCases.length}</b> requests</span><div><button disabled>←</button><button className="page-current">1</button><button disabled>→</button></div></div>
          </section>

          {selected && <section className="detail-grid"><article className="detail-card"><div className="detail-head"><div><div className="section-kicker">SELECTED REQUEST <span className="detail-id">{selected.id}</span></div><h2>{selected.title}</h2></div><span className={`status-badge ${statusClass(selected.status)}`}><i />{selected.status}</span></div><div className="detail-meta"><div><span>REQUESTER</span><b>{selected.requester}</b><small>{selected.email}</small>{selected.department && <small>Department: {selected.department}</small>}</div><div><span>ASSIGNED WORKER</span><b>{selected.assignedWorkerName || selected.team}</b><small>{selected.offlineQueued ? 'Worker assignment will happen after syncing.' : `${selected.department} department · ${selected.category} issue`}</small></div><div><span>PRIORITY</span><b><span className={`priority ${selected.priority.toLowerCase()}`}><i />{selected.priority}</span></b><small>{selected.created}</small></div></div><div className="request-description"><span>REQUEST DETAILS</span><p>{selected.description}</p></div>{selected.missing && <div className="missing-box"><span>!</span><div><b>More information needed</b><p>{selected.missing}</p></div></div>}<div className="approval-box"><div className="approval-symbol">{selected.status === 'Completed' ? '✓' : selected.status === 'Awaiting approval' ? '⌑' : '⚡'}</div><div><b>{selected.offlineQueued ? 'Saved on this device' : selected.status === 'Completed' ? 'Request completed' : selected.status === 'Awaiting approval' ? 'Approval required' : selected.status === 'Failed' ? 'Action interrupted safely' : selected.missing ? 'Waiting for requester' : 'Your problem will be rectified shortly.'}</b><p>{selected.offlineQueued ? 'It has not reached the workers yet. When the connection returns, the server will classify it and route it to a worker in your department.' : selected.status === 'Completed' ? 'All actions are recorded. Re-running is disabled to prevent duplicates.' : selected.status === 'Awaiting approval' ? 'This request needs an approver before the team takes action.' : selected.status === 'Failed' ? 'The mock tool failed before making a change. You can safely retry.' : selected.missing ? 'The coordinator will not act until the required details are provided.' : 'Your request has been sent to the responsible department team.'}</p></div></div><div className="detail-actions">{currentUser.role === 'team' && selected.status === 'Awaiting approval' && <button className="primary-button" onClick={approveCase}>✓ Approve request</button>}{currentUser.role === 'team' && selected.status === 'Failed' && <button className="primary-button" onClick={retryAction}>↻ Retry action</button>}{currentUser.role === 'team' && selected.status === 'Requested' && <button className="primary-button" onClick={markOngoing}>↻ Mark ongoing</button>}{currentUser.role === 'team' && ['Ongoing', 'In progress'].includes(selected.status) && !selected.missing && <button className="primary-button" onClick={runMockAction}>⚡ Run mock action</button>}{currentUser.role === 'team' && selected.status === 'Completed' && <button className="secondary-button" onClick={runMockAction}>✓ Action completed</button>}{selected.status === 'Needs information' && <button className="secondary-button" onClick={() => setNotice('Follow-up request sent to ' + selected.requester + '.')}>↗ Send follow-up</button>}{currentUser.role === 'team' && <button className="secondary-button" onClick={() => setNotice(`Request ${selected.id} assigned to ${selected.team}.`)}>↗ Reassign</button>}<RequestActionsMenu item={selected} className="more-button" open={openMenuId === `detail-${selected.id}`} onToggle={() => setOpenMenuId(openMenuId === `detail-${selected.id}` ? null : `detail-${selected.id}`)} onView={() => setOpenMenuId(null)} onDelete={() => deleteCase(selected)} /></div></article>
            <article className="audit-card"><div className="audit-heading"><div><div className="section-kicker">CASE HISTORY</div><h2>Activity log</h2></div><button className="icon-button">↗</button></div><div className="audit-list">{selected.logs.map((log, index) => <div className="audit-entry" key={`${log.time}-${index}`}><div className={`audit-marker ${log.type}`}>{log.type === 'success' ? '✓' : log.type === 'warning' ? '!' : '·'}</div><div><p>{log.text}</p><span>{log.time} <i>·</i> {index === 0 ? 'Service coordinator' : 'System'}</span></div></div>)}</div><button className="audit-link" onClick={() => setNotice(`Audit log for ${selected.id} is up to date.`)}>View full audit trail <span>→</span></button></article></section>}
          <footer className="page-footer"><span>© 2026 Innovate X Service Desk</span><span><i className="footer-live"/> All systems operational</span><span>Privacy <b>·</b> Status <b>·</b> Help</span></footer>
        </div>
      </main>
    </div>
  )
}

export default App


