import { useEffect, useState } from 'react'
import './AdminPage.css'

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
async function adminApi(path, options = {}) {
  const token = sessionStorage.getItem('innovate-x-demo-token')
  const response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...options.headers } })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Could not complete this action.')
  return result
}

export default function AdminPage({ user, onSignOut, onUpdateUser }) {
  const [users, setUsers] = useState([])
  const [requests, setRequests] = useState([])
  const [requestDepartment, setRequestDepartment] = useState('All departments')
  const [requestsLoading, setRequestsLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [role, setRole] = useState('requester')
  const [requesterType, setRequesterType] = useState('student')
  const [editingUser, setEditingUser] = useState(null)
  const [editingRequesterType, setEditingRequesterType] = useState('student')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingUserId, setDeletingUserId] = useState('')

  async function loadUsers() {
    try { setUsers(await adminApi('/api/users')); setError('') }
    catch (problem) { setError(problem.message) }
    finally { setLoading(false) }
  }
  async function loadRequests() {
    try { setRequests(await adminApi('/api/requests')); setError('') }
    catch (problem) { setError(problem.message) }
    finally { setRequestsLoading(false) }
  }
  useEffect(() => { loadUsers(); loadRequests() }, [])

  const requestDepartments = ['All departments', ...new Set(requests.map((item) => item.department || 'No department'))]
  const filteredRequests = requestDepartment === 'All departments'
    ? requests
    : requests.filter((item) => (item.department || 'No department') === requestDepartment)
  const requestsByDepartment = filteredRequests.reduce((groups, item) => {
    const department = item.department || 'No department'
    groups[department] = [...(groups[department] || []), item]
    return groups
  }, {})

  async function createUser(event) {
    event.preventDefault(); setSubmitting(true); setError(''); setNotice('')
    const form = event.currentTarget
    const data = Object.fromEntries(new FormData(form).entries())
    try {
      const created = await adminApi('/api/users', { method: 'POST', body: JSON.stringify(data) })
      setUsers((current) => [...current, created])
      setNotice(`${created.role === 'team' ? 'Worker' : 'Requester'} account created${created.department ? ` for the ${created.department} department` : ''}. They can sign in with the Login ID and password you set.`)
      form.reset()
      setRole('requester'); setRequesterType('student')
    } catch (problem) { setError(problem.message) }
    finally { setSubmitting(false) }
  }

  async function savePersonInfo(event) {
    event.preventDefault(); setSavingEdit(true); setError('')
    const data = Object.fromEntries(new FormData(event.currentTarget).entries())
    try {
      const updated = await adminApi(`/api/users/${editingUser.id}`, { method: 'PATCH', body: JSON.stringify(data) })
      setUsers((current) => current.map((account) => account.id === updated.id ? updated : account))
      if (updated.id === user.id) onUpdateUser(updated)
      setEditingUser(null)
      setNotice(`${updated.name}'s information has been updated.`)
    } catch (problem) { setError(problem.message) }
    finally { setSavingEdit(false) }
  }

  async function deleteUser(account) {
    const confirmed = window.confirm(`Delete the ${account.role === 'team' ? 'worker' : account.role === 'admin' ? 'administrator' : 'requester'} account for ${account.name}? This cannot be undone.`)
    if (!confirmed) return
    setDeletingUserId(account.id); setError(''); setNotice('')
    try {
      await adminApi(`/api/users/${encodeURIComponent(account.id)}`, { method: 'DELETE' })
      setUsers((current) => current.filter((item) => item.id !== account.id))
      setNotice(`${account.name}'s account has been deleted.`)
    } catch (problem) { setError(problem.message) }
    finally { setDeletingUserId('') }
  }

  return <main className="admin-page">
    <header className="admin-topbar"><div className="admin-brand"><span className="admin-logo-wrap"><img src="/innovate-x-mark.png" alt="Innovate X N logo" /></span><b>INNOVATE <em>X</em></b><i>ADMIN</i></div><div className="admin-user"><div className="admin-avatar">{user.name.split(' ').map((word) => word[0]).join('')}</div><span>{user.name}</span><button onClick={onSignOut}>↪ <span>Sign out</span></button></div></header>
    <section className="admin-content"><div className="admin-welcome"><div><span className="admin-eyebrow">WORKSPACE ADMINISTRATION</span><h1>People & access</h1><p>Create accounts for the workers and requesters.</p></div><div className="admin-summary"><span>ACTIVE ACCOUNTS</span><b>{users.length}</b><small>Workers, requesters, and admin</small></div></div>
      {error && <div className="admin-alert error">{error}</div>}{notice && <div className="admin-alert success">✓ {notice}<button onClick={() => setNotice('')}>×</button></div>}
      <section className="admin-card admin-requests-card">
        <div className="admin-card-heading"><div className="admin-card-icon lavender">▤</div><div><h2>All requests by department</h2><p>Review each request, its category, status, requester, and assigned worker.</p></div><button className="refresh-accounts" onClick={loadRequests} title="Refresh requests">↻</button></div>
        <div className="admin-request-toolbar"><label htmlFor="admin-request-department">Department</label><select id="admin-request-department" value={requestDepartment} onChange={(event) => setRequestDepartment(event.target.value)}><option>All departments</option>{requestDepartments.filter((department) => department !== 'All departments').map((department) => <option key={department}>{department}</option>)}</select><span>{filteredRequests.length} request{filteredRequests.length === 1 ? '' : 's'}</span></div>
        {requestsLoading ? <div className="admin-empty">Loading requests…</div> : filteredRequests.length === 0 ? <div className="admin-empty">No requests found for this department.</div> : <div className="admin-request-groups">{Object.entries(requestsByDepartment).map(([department, departmentRequests]) => <section className="admin-request-group" key={department}><div className="admin-request-group-heading"><h3>{department}</h3><span>{departmentRequests.length} request{departmentRequests.length === 1 ? '' : 's'}</span></div>{departmentRequests.map((item) => <article className="admin-request-item" key={item.id}><div className="admin-request-title"><b>{item.title}</b><small>{item.id} · {item.created || 'Date unavailable'}</small></div><div className="admin-request-meta"><span><small>REQUESTER</small>{item.requester || 'Unknown'}</span><span><small>CATEGORY</small>{item.category || 'Unclassified'}</span><span><small>ASSIGNED WORKER</small>{item.assignedWorkerName || 'Unassigned'}</span><span><small>PRIORITY</small>{item.priority || 'Normal'}</span><span><small>STATUS</small><em className={`admin-request-status ${String(item.status || 'Requested').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>{item.status || 'Requested'}</em></span></div><details className="admin-request-details"><summary>More request details</summary><p>{item.description || 'No additional description provided.'}</p>{item.missing && <p><b>Follow-up needed:</b> {item.missing}</p>}{item.logs?.length > 0 && <div className="admin-request-history"><b>Recent activity</b>{item.logs.slice(0, 3).map((log, index) => <p key={`${item.id}-log-${index}`}>{log.time ? `${log.time} · ` : ''}{log.text}</p>)}</div>}</details></article>)}</section>)}</div>}
      </section>
      <div className="admin-columns"><section className="admin-card create-account"><div className="admin-card-heading"><div className="admin-card-icon">＋</div><div><h2>Add an account</h2><p>New users can sign in as soon as you create them.</p></div></div><form onSubmit={createUser}><label>Full name<input name="name" placeholder="e.g. Sam Taylor" autoComplete="name" required /></label><label>Login ID<input name="loginId" type="text" pattern="[A-Za-z0-9]{3,24}" title="Use 3–24 letters and numbers only." placeholder="e.g. Sam123" autoComplete="username" required /><small>Use letters and numbers only (3–24 characters).</small></label><label>Temporary password<input name="password" type="password" placeholder="At least 8 characters" minLength="8" autoComplete="new-password" required /><small>Share this password with the new user securely.</small></label><label>Account type<select name="role" value={role} onChange={(event) => setRole(event.target.value)}><option value="requester">Requester</option><option value="team">Worker</option></select></label>{role === 'team' && <><label>Service category<select name="category" defaultValue="Hardware" required><option>Hardware</option><option>Software</option><option>Electrical</option><option>Networking</option><option>Cleaning</option><option>Water</option></select><small>Worker category is a specialty; requests are assigned to one worker in the requester's department.</small></label><label>Department<select name="department" defaultValue="" required><option value="">Select department</option><option>CSE</option><option>IT</option><option>BIO-TECH</option><option>BIO-MEDICAL</option><option>CIVIL</option><option>MECH</option><option>AIDS</option><option>B.Ed</option><option>ECE</option><option>EEE</option></select></label></>}{role === 'requester' && <><label>Requester type<select name="requesterType" value={requesterType} onChange={(event) => setRequesterType(event.target.value)} required><option value="student">Student</option><option value="teaching_staff">Teaching Staff</option><option value="other_staff">Other Staff</option></select></label>{requesterType !== 'other_staff' && <label>Department<select name="department" defaultValue="" required><option value="">Select department</option><option>CSE</option><option>IT</option><option>BIO-TECH</option><option>BIO-MEDICAL</option><option>CIVIL</option><option>MECH</option><option>AIDS</option><option>B.Ed</option><option>ECE</option><option>EEE</option></select></label>}</>}<button className="admin-create-button" disabled={submitting}>{submitting ? 'Creating account…' : 'Create account'} <span>→</span></button></form></section>
      <section className="admin-card account-list"><div className="admin-card-heading"><div className="admin-card-icon lavender">♙</div><div><h2>Workspace accounts</h2><p>Accounts currently able to access Innovate X.</p></div><button className="refresh-accounts" onClick={loadUsers} title="Refresh list">↻</button></div>{loading ? <div className="admin-empty">Loading accounts…</div> : users.length === 0 ? <div className="admin-empty">No accounts found.</div> : <div className="account-table"><div className="account-table-head"><span>PERSON</span><span>ROLE / CATEGORY</span><span>ADDED</span><span>ACTIONS</span></div>{users.map((account) => <div className="account-row" key={account.id}><div className="account-person"><div className={`admin-avatar small ${account.role}`}>{account.name.split(' ').map((word) => word[0]).join('')}</div><div><b>{account.name}</b><small>{account.loginId || account.email}</small></div></div><span className={`role-chip ${account.role}`}>{account.role === 'admin' ? 'Admin' : account.role === 'team' ? `Worker · ${account.category === 'all' ? 'All categories' : account.category || 'Unassigned'} · ${account.department || 'No department'}` : account.requesterType === 'other_staff' ? 'Other staff' : `${account.requesterType === 'teaching_staff' ? 'Teaching staff' : 'Student'} · ${account.department || 'No department'}`}</span><span className="account-date">{account.created}</span><div className="account-row-actions"><button className="edit-person-button" onClick={() => { setEditingUser(account); setEditingRequesterType(account.requesterType || 'student'); setError('') }}>Edit</button><button className="delete-person-button" onClick={() => deleteUser(account)} disabled={deletingUserId === account.id || account.id === user.id} title={account.id === user.id ? 'You cannot delete your own signed-in account' : 'Delete account'}>{deletingUserId === account.id ? 'Deleting…' : 'Delete'}</button></div></div>)}</div>}<div className="account-security"><span>⌑</span> Passwords are stored as one-way hashes by the prototype backend.</div></section></div>
      {editingUser && <div className="admin-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingUser(null) }}><form className="admin-edit-modal" onSubmit={savePersonInfo}><div className="edit-modal-heading"><div><span className="admin-eyebrow">EDIT ACCOUNT</span><h2>Person information</h2></div><button type="button" className="edit-modal-close" onClick={() => setEditingUser(null)}>×</button></div><label>Full name<input name="name" defaultValue={editingUser.name} required /></label><label>Login ID<input name="loginId" type="text" pattern={String(editingUser.loginId || editingUser.email).includes('@') ? undefined : '[A-Za-z0-9]{3,24}'} title="Use 3–24 letters and numbers only." defaultValue={editingUser.loginId || editingUser.email} required /></label><label>Account type<input value={editingUser.role === 'admin' ? 'Administrator' : editingUser.role === 'team' ? 'Worker' : 'Requester'} disabled /></label>{editingUser.role === 'team' && <><label>Service category<select name="category" defaultValue={editingUser.category || 'Hardware'} required><option>Hardware</option><option>Software</option><option>Electrical</option><option>Networking</option><option>Cleaning</option><option>Water</option></select></label><label>Department<select name="department" defaultValue={editingUser.department || 'CSE'} required><option>CSE</option><option>IT</option><option>BIO-TECH</option><option>BIO-MEDICAL</option><option>CIVIL</option><option>MECH</option><option>AIDS</option><option>B.Ed</option><option>ECE</option><option>EEE</option></select></label></>}{editingUser.role === 'requester' && <><label>Requester type<select name="requesterType" value={editingRequesterType} onChange={(event) => setEditingRequesterType(event.target.value)} required><option value="student">Student</option><option value="teaching_staff">Teaching Staff</option><option value="other_staff">Other Staff</option></select></label>{editingRequesterType !== 'other_staff' && <label>Department<select name="department" defaultValue={editingUser.department || 'CSE'} required><option>CSE</option><option>IT</option><option>BIO-TECH</option><option>BIO-MEDICAL</option><option>CIVIL</option><option>MECH</option><option>AIDS</option><option>B.Ed</option><option>ECE</option><option>EEE</option></select></label>}</>}<div className="edit-modal-actions"><button type="button" className="edit-cancel" onClick={() => setEditingUser(null)}>Cancel</button><button className="admin-create-button" disabled={savingEdit}>{savingEdit ? 'Saving…' : 'Save changes'}</button></div></form></div>}
      <footer className="admin-footer"><span>Innovate X Service Desk</span><span>Demo administration workspace</span></footer>
    </section>
  </main>
}

