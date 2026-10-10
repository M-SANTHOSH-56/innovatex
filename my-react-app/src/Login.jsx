import { useState } from 'react'
import './Login.css'

const demoAccounts = {
  team: { loginId: 'team@innovatex.demo', password: 'team123', label: 'Worker', description: 'Workers can review requests, approvals, and activity.' },
  requester: { loginId: 'requester@innovatex.demo', password: 'request123', label: 'Requester', description: 'Requesters can submit a request and follow their own cases.' },
  admin: { loginId: 'admin@innovatex.demo', password: 'admin123', label: 'Administrator', description: 'Admins can create and manage worker and requester accounts.' },
}
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const productionBuild = import.meta.env.PROD

export default function Login({ onLogin }) {
  const [role, setRole] = useState('team')
  const [loginId, setLoginId] = useState(productionBuild ? '' : demoAccounts.team.loginId)
  const [password, setPassword] = useState(productionBuild ? '' : demoAccounts.team.password)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function chooseRole(nextRole) {
    setRole(nextRole); setLoginId(productionBuild ? '' : demoAccounts[nextRole].loginId); setPassword(productionBuild ? '' : demoAccounts[nextRole].password); setError('')
  }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const response = await fetch(`${apiBaseUrl}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ loginId, password }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to sign in.')
      onLogin(result.user, result.token)
    } catch (problem) {
      setError(problem.message || 'Unable to connect to the service. Start it with npm run dev.')
    } finally { setBusy(false) }
  }

  return <main className="login-page">
    <section className="login-showcase">
      <div className="login-brand"><span className="logo-image-wrap"><img src="/innovate-x-mark.png" alt="Innovate X N logo" /></span><b>INNOVATE <em>X</em></b></div>
      <div className="showcase-copy"><span className="showcase-kicker">SERVICE DESK, MADE RESILIENT</span><h1>Help your team<br/>keep moving.</h1><p>One place to manage requests, approvals, and updates — even when a step needs a second try.</p><div className="showcase-proof"><span>✓</span> Every request has a clear trail</div></div>
      <div className="showcase-card"><div className="showcase-card-icon">⌁</div><div><b>Requests, handled with care.</b><small>Safe actions. Clear updates. No lost cases.</small></div><span className="showcase-arrow">↗</span></div>
      <div className="showcase-footer">© 2026 Innovate X <span>•</span> Service Desk</div>
    </section>
    <section className="login-main"><div className="login-form-wrap">
      <div className="mobile-login-brand"><span className="logo-image-wrap"><img src="/innovate-x-mark.png" alt="Innovate X N logo" /></span><b>INNOVATE <em>X</em></b></div>
      <div className="login-welcome"><span className="login-eyebrow">WELCOME BACK</span><h2>Sign in to your workspace</h2><p>Choose your account type to continue.</p></div>
      <div className="role-tabs" role="tablist" aria-label="Choose account type">{Object.entries(demoAccounts).map(([key, account]) => <button key={key} className={role === key ? 'active' : ''} onClick={() => chooseRole(key)} type="button"><span>{key === 'team' ? '▦' : key === 'requester' ? '♙' : '⚙'}</span>{account.label}</button>)}</div>
      <form className="login-form" onSubmit={submit}><label>Login ID<input type="text" autoComplete="username" value={loginId} onChange={(event) => setLoginId(event.target.value)} required /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <div className="login-error">{error}</div>}<button className="login-submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <span>→</span></button></form>
      {!productionBuild && <div className="demo-credentials"><div className="demo-title"><span>DEMO ACCOUNT</span><span className="demo-pill">PROTOTYPE</span></div><p>{demoAccounts[role].description}</p><div className="demo-row"><span>Login ID</span><code>{demoAccounts[role].loginId}</code></div><div className="demo-row"><span>Password</span><code>{demoAccounts[role].password}</code></div><button type="button" className="use-demo" onClick={() => { setLoginId(demoAccounts[role].loginId); setPassword(demoAccounts[role].password); setError('') }}>Use demo account <span>↗</span></button></div>}
      <div className="login-legal">By continuing, you agree to the <a href="#terms">Terms of Service</a> and <a href="#privacy">Privacy Policy</a>.</div>
    </div><div className="login-copyright">Secure workspace access <span>•</span> Need help? Contact your service desk admin</div></section>
  </main>
}
