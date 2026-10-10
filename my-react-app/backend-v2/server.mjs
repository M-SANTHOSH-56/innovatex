import { createServer } from 'node:http'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.DATA_DIR || join(root, 'data')
const databaseFile = join(dataDir, 'cases.json')
const usersFile = join(dataDir, 'users.json')
try {
  const envText = await readFile(join(root, '.env'), 'utf8')
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const port = Number(process.env.PORT || process.env.API_PORT || 4001)
const sessions = new Map()
const teamCategories = ['Hardware', 'Software', 'Electrical', 'Networking', 'Cleaning', 'Water']
const issueLabels = ['Hardware issue', 'Software issue', 'Electrical issue', 'Network issue', 'Cleaning or facility issue', 'Water supply issue', 'Account access issue', 'Other or unclear issue']
const issueCategoryByLabel = new Map([
  ['Hardware issue', 'Hardware'], ['Software issue', 'Software'], ['Electrical issue', 'Electrical'],
  ['Network issue', 'Network issue'], ['Cleaning or facility issue', 'Cleaning'],
  ['Water supply issue', 'Water'], ['Account access issue', 'Account access'], ['Other or unclear issue', 'Other'],
])
const classifierModel = 'MoritzLaurer/deberta-v3-base-zeroshot-v1.1-all-33'
const requesterTypes = ['student', 'teaching_staff', 'other_staff']
const departments = ['CSE', 'IT', 'BIO-TECH', 'BIO-MEDICAL', 'CIVIL', 'MECH', 'AIDS', 'B.Ed', 'ECE', 'EEE']
function workerCanHandle(worker, item) {
  return worker.role === 'team' && worker.department === item.department && worker.id === item.assignedWorkerId
}
const workerCategoryByIssue = new Map([
  ['Hardware', 'Hardware'], ['Software', 'Software'], ['Electrical', 'Electrical'],
  ['Network issue', 'Networking'], ['Cleaning', 'Cleaning'], ['Water', 'Water'],
])

const seedCases = [
  { id: 'SD-2048', title: 'Laptop access for new team member', requester: 'Priya Sharma', email: 'priya.sharma@acme.io', category: 'Hardware', priority: 'High', status: 'Awaiting approval', team: 'IT Operations', created: 'Today, 10:42 AM', description: 'A new design team member needs a company laptop configured with the approved design tools.', missing: '', needsApproval: true, actionDone: false, logs: [{ time: '10:43 AM', text: 'Routed to IT Operations. Manager approval required.', type: 'success' }, { time: '10:42 AM', text: 'Request received and classified as Hardware.', type: 'info' }] },
  { id: 'SD-2047', title: 'Reset account password', requester: 'Marcus Lee', email: 'marcus.lee@acme.io', category: 'Account access', priority: 'Medium', status: 'In progress', team: 'Identity & Access', created: 'Today, 10:18 AM', description: 'Unable to sign in after a password change. Please help restore access.', missing: '', needsApproval: false, actionDone: false, demoFailurePending: true, logs: [{ time: '10:20 AM', text: 'Mock identity API timed out. Safe to retry.', type: 'warning' }, { time: '10:19 AM', text: 'Identity check started.', type: 'success' }, { time: '10:18 AM', text: 'Request received and classified as Account access.', type: 'info' }] },
  { id: 'SD-2046', title: 'Install analytics software', requester: 'Nina Patel', email: 'nina.patel@acme.io', category: 'Software', priority: 'Low', status: 'Needs information', team: 'Business Systems', created: 'Today, 9:56 AM', description: 'Please install the analytics application on my workstation.', missing: 'Please specify the application name and your device ID.', needsApproval: false, actionDone: false, logs: [{ time: '9:57 AM', text: 'Missing required details. Follow-up requested.', type: 'warning' }, { time: '9:56 AM', text: 'Request received and classified as Software.', type: 'info' }] },
  { id: 'SD-2045', title: 'VPN access for remote work', requester: 'Jordan Kim', email: 'jordan.kim@acme.io', category: 'Account access', priority: 'Medium', status: 'Completed', team: 'Identity & Access', created: 'Today, 9:31 AM', description: 'Enable the standard VPN profile for my approved remote work setup.', missing: '', needsApproval: false, actionDone: true, logs: [{ time: '9:35 AM', text: 'VPN access provisioned successfully.', type: 'success' }, { time: '9:33 AM', text: 'Policy check passed. Request routed to Identity & Access.', type: 'success' }, { time: '9:31 AM', text: 'Request received and classified as Account access.', type: 'info' }] },
]

const timeNow = () => new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date())
function passwordHash(password, salt) { return scryptSync(password, salt, 64).toString('hex') }
function publicUser(user) { return { id: user.id, name: user.name, loginId: user.loginId || user.email, email: user.email || '', role: user.role, category: user.category || null, requesterType: user.requesterType || null, department: user.department || null, created: user.created } }
async function readUsers() {
  try {
    const users = JSON.parse(await readFile(usersFile, 'utf8'))
    const demoTeam = users.find((user) => user.email.toLowerCase() === 'team@innovatex.demo')
    if (demoTeam && demoTeam.role === 'team') {
      let changed = false
      if (!demoTeam.category) { demoTeam.category = 'all'; changed = true }
      if (!demoTeam.department) { demoTeam.department = 'CSE'; changed = true }
      if (changed) await saveUsers(users)
    }
    const demoRequester = users.find((user) => user.email.toLowerCase() === 'requester@innovatex.demo')
    if (demoRequester && demoRequester.role === 'requester' && !demoRequester.department) {
      demoRequester.requesterType ||= 'student'
      demoRequester.department = 'CSE'
      await saveUsers(users)
    }
    return users
  }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    await mkdir(dirname(usersFile), { recursive: true })
    const production = process.env.NODE_ENV === 'production'
    const initialAdminLogin = String(process.env.INITIAL_ADMIN_LOGIN_ID || '').trim()
    const initialAdminPassword = String(process.env.INITIAL_ADMIN_PASSWORD || '')
    if (production && (!/^[A-Za-z0-9]{3,24}$/.test(initialAdminLogin) || initialAdminPassword.length < 8)) {
      throw new Error('Set INITIAL_ADMIN_LOGIN_ID (3–24 letters/numbers) and INITIAL_ADMIN_PASSWORD (at least 8 characters) before first production start.')
    }
    const accounts = production
      ? [{ name: process.env.INITIAL_ADMIN_NAME || 'Innovate X Admin', loginId: initialAdminLogin, email: `${initialAdminLogin}@innovatex.local`, password: initialAdminPassword, role: 'admin' }]
      : [
        { name: 'Alex Morgan', email: 'team@innovatex.demo', password: 'team123', role: 'team', category: 'all' },
        { name: 'Marcus Lee', email: 'requester@innovatex.demo', password: 'request123', role: 'requester', requesterType: 'student', department: 'CSE' },
        { name: 'Innovate X Admin', email: 'admin@innovatex.demo', password: 'admin123', role: 'admin' },
      ]
    const demo = accounts.map((account) => {
      const salt = randomBytes(16).toString('hex')
      return { id: randomUUID(), name: account.name, loginId: account.loginId || account.email, email: account.email, role: account.role, category: account.category || null, requesterType: account.requesterType || null, department: account.department || null, salt, passwordHash: passwordHash(account.password, salt), created: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
    })
    await writeFile(usersFile, JSON.stringify(demo, null, 2))
    return demo
  }
}
async function saveUsers(users) {
  await mkdir(dirname(usersFile), { recursive: true })
  await writeFile(usersFile, JSON.stringify(users, null, 2))
}
function chooseWorkerForDepartment(department, users, cases, issueCategory = '') {
  const departmentWorkers = users.filter((user) => user.role === 'team' && user.department === department)
  if (!departmentWorkers.length) return null
  const requiredCategory = workerCategoryByIssue.get(issueCategory)
  const specialists = requiredCategory
    ? departmentWorkers.filter((worker) => worker.category === requiredCategory || worker.category === 'all')
    : []
  // Prefer the matching specialist; if none exists, keep routing within the requester's department.
  const workers = specialists.length ? specialists : departmentWorkers
  const workerIds = new Set(workers.map((worker) => worker.id))
  const totalLoad = new Map(workers.map((worker) => [worker.id, 0]))
  const activeLoad = new Map(workers.map((worker) => [worker.id, 0]))
  for (const item of cases) {
    if (item.department !== department || !workerIds.has(item.assignedWorkerId)) continue
    totalLoad.set(item.assignedWorkerId, totalLoad.get(item.assignedWorkerId) + 1)
    if (!['Completed', 'Escalated'].includes(item.status)) activeLoad.set(item.assignedWorkerId, activeLoad.get(item.assignedWorkerId) + 1)
  }
  return workers.reduce((best, worker) => {
    if (!best) return worker
    const activeDifference = activeLoad.get(worker.id) - activeLoad.get(best.id)
    const totalDifference = totalLoad.get(worker.id) - totalLoad.get(best.id)
    return activeDifference < 0 || (activeDifference === 0 && totalDifference < 0) ? worker : best
  }, null)
}
function authenticatedUser(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  return token ? sessions.get(token) : null
}
async function readCases() {
  try {
    const cases = JSON.parse(await readFile(databaseFile, 'utf8'))
    let changed = false
    const users = await readUsers()
    for (const item of cases) {
      if (/^SD-204[5-8]$/.test(item.id) && !item.department) { item.department = 'CSE'; changed = true }
      if (item.department) {
        const assigned = users.find((user) => user.id === item.assignedWorkerId && user.role === 'team' && user.department === item.department)
        const requiredCategory = workerCategoryByIssue.get(item.category)
        const hasSpecialist = requiredCategory && users.some((user) => user.role === 'team' && user.department === item.department && (user.category === requiredCategory || user.category === 'all'))
        const assignedMatches = assigned && (!hasSpecialist || assigned.category === requiredCategory || assigned.category === 'all')
        if (!assignedMatches) {
          const worker = chooseWorkerForDepartment(item.department, users, cases, item.category)
          if (worker) {
            const oldWorkerName = item.assignedWorkerName || assigned?.name || 'previous worker'
            item.assignedWorkerId = worker.id
            item.assignedWorkerName = worker.name
            item.logs = Array.isArray(item.logs) ? item.logs : []
            item.logs.unshift(makeLog(`Reassigned from ${oldWorkerName} to ${worker.name} in ${item.department} to match the ${item.category} specialty.`, 'info'))
            changed = true
          }
        }
      }
    }
    if (changed) await saveCases(cases)
    return cases
  }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    await mkdir(dirname(databaseFile), { recursive: true })
    const seeded = structuredClone(seedCases).map((item) => ({ ...item, department: 'CSE' }))
    const users = await readUsers()
    for (const item of seeded) {
      const worker = chooseWorkerForDepartment(item.department, users, seeded)
      if (worker) { item.assignedWorkerId = worker.id; item.assignedWorkerName = worker.name }
    }
    await writeFile(databaseFile, JSON.stringify(seeded, null, 2))
    return seeded
  }
}
async function saveCases(cases) {
  await mkdir(dirname(databaseFile), { recursive: true })
  await writeFile(databaseFile, JSON.stringify(cases, null, 2))
}
function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' })
  res.end(JSON.stringify(data))
}
async function readBody(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  return raw ? JSON.parse(raw) : {}
}
function makeLog(text, type = 'info') { return { time: timeNow(), text, type } }
function classifyWithKeywords(text) {
  const networkContext = /\b(network|internet|wifi|wi-fi|wireless|router|ethernet|vpn|connectivity|connection)\b/i.test(text)
  const explicitElectricalContext = /\b(electric|electrical|electricity|outlet|socket|wiring|fuse|voltage|breaker|circuit|bulb|lamp|lighting|power outage|fan)\b/i.test(text)
  // A router/network status light is usually a network issue, not a building electrical issue.
  if (networkContext && !explicitElectricalContext) return { category: 'Network issue', score: null, source: 'keyword-fallback' }
  const rules = [
    ['Hardware', /\b(laptop|computer|desktop|pc|cpu|processor|keyboard|mouse|monitor|printer|projector|device|hardware|battery|screen|charger|broken computer)\b/i],
    ['Software', /\b(software|app|application|install|program|license|browser|crash|bug|update|login page|not opening|won't open)\b/i],
    ['Electrical', /\b(electric|electrical|electricity|power|outlet|socket|switch|wiring|light|lights|lighting|fuse|voltage|fan|bulb|lamp|breaker|circuit)\b/i],
    ['Network issue', /\b(network|internet|wifi|wi-fi|wireless|router|ethernet|vpn|connection|connectivity|no signal|disconnected)\b/i],
    ['Cleaning', /\b(clean|cleaning|dirty|sweep|garbage|trash|washroom|toilet|sanitation|janitor)\b/i],
    ['Water', /\b(water|tap|faucet|drinking|leak|leaking|pipeline|plumbing|supply)\b/i],
    ['Account access', /\b(password|account|access|sign in|signin|log in|login|locked|permission|credentials)\b/i],
  ]
  const ranked = rules.map(([category, pattern]) => ({ category, score: (text.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)) || []).length }))
    .sort((a, b) => b.score - a.score)
  return ranked[0]?.score ? { category: ranked[0].category, score: null, source: 'keyword-fallback' } : { category: 'Other', score: null, source: 'keyword-fallback' }
}
async function classifyIssue(title, description) {
  const text = `${title}\n${description}`.slice(0, 1800)
  const token = process.env.HF_TOKEN
  if (token) {
    try {
      const endpoint = process.env.HF_ZERO_SHOT_URL || `https://router.huggingface.co/hf-inference/models/${classifierModel}`
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ inputs: text, parameters: { candidate_labels: issueLabels, hypothesis_template: 'This service request is about {}.', multi_label: false } }),
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) throw new Error(`Classifier returned HTTP ${response.status}`)
      const result = await response.json()
      const labels = Array.isArray(result) ? result : result?.labels?.map((label, index) => ({ label, score: result.scores?.[index] }))
      const best = labels?.filter((entry) => issueCategoryByLabel.has(entry.label)).sort((a, b) => b.score - a.score)[0]
      if (!best) throw new Error('Classifier returned no recognized category.')
      return { category: issueCategoryByLabel.get(best.label), score: Number(best.score), source: 'deberta-v3' }
    } catch (error) {
      console.warn(`DeBERTa classification unavailable; using keyword fallback: ${error.message}`)
    }
  }
  return classifyWithKeywords(text)
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type,authorization' })
    return res.end()
  }
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, service: 'Innovate X Service Desk API', classifier: { model: classifierModel, mode: process.env.HF_TOKEN ? 'deberta-v3' : 'keyword-fallback', tokenConfigured: Boolean(process.env.HF_TOKEN) } })
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = await readBody(req)
      const loginId = String(body.loginId || body.email || '').trim().toLowerCase()
      const password = body.password
      const users = await readUsers()
      const user = users.find((item) => String(item.loginId || item.email || '').toLowerCase() === loginId)
      if (!user || !timingSafeEqual(Buffer.from(user.passwordHash, 'hex'), Buffer.from(passwordHash(String(password || ''), user.salt), 'hex'))) return send(res, 401, { error: 'Login ID or password is incorrect.' })
      const token = randomBytes(32).toString('hex')
      sessions.set(token, publicUser(user))
      return send(res, 200, { token, user: publicUser(user) })
    }
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
      if (token) sessions.delete(token)
      return send(res, 200, { ok: true })
    }
    const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/)
    if (req.method === 'PATCH' && userMatch) {
      const currentUser = authenticatedUser(req)
      if (!currentUser) return send(res, 401, { error: 'Please sign in first.' })
      if (currentUser.role !== 'admin') return send(res, 403, { error: 'Only an administrator can edit accounts.' })
      const users = await readUsers()
      const user = users.find((item) => item.id === decodeURIComponent(userMatch[1]))
      if (!user) return send(res, 404, { error: 'Account not found.' })
      const body = await readBody(req)
      const name = String(body.name || '').trim()
      const loginId = String(body.loginId || '').trim()
      const validLoginId = /^[A-Za-z0-9]{3,24}$/.test(loginId) || (user.email && user.email.toLowerCase() === loginId.toLowerCase())
      if (!name || !validLoginId) return send(res, 400, { error: 'Enter a name and a Login ID with 3–24 letters or numbers.' })
      if (users.some((item) => item.id !== user.id && String(item.loginId || item.email || '').toLowerCase() === loginId.toLowerCase())) return send(res, 409, { error: 'Another account already uses this Login ID.' })
      if (user.role === 'team' && (!teamCategories.includes(body.category) || !departments.includes(body.department))) return send(res, 400, { error: 'Choose a valid service category and department for this worker.' })
      if (user.role === 'requester' && (!requesterTypes.includes(body.requesterType) || (body.requesterType !== 'other_staff' && !departments.includes(body.department)))) return send(res, 400, { error: 'Choose a requester type and a valid department when required.' })
      user.name = name
      user.loginId = loginId
      user.category = user.role === 'team' ? body.category : null
      user.requesterType = user.role === 'requester' ? body.requesterType : null
      user.department = user.role === 'team' ? body.department : user.role === 'requester' && body.requesterType !== 'other_staff' ? body.department : null
      await saveUsers(users)
      const updated = publicUser(user)
      for (const [token, sessionUser] of sessions) if (sessionUser.id === user.id) sessions.set(token, updated)
      return send(res, 200, updated)
    }
    if (req.method === 'DELETE' && userMatch) {
      const currentUser = authenticatedUser(req)
      if (!currentUser) return send(res, 401, { error: 'Please sign in first.' })
      if (currentUser.role !== 'admin') return send(res, 403, { error: 'Only an administrator can delete accounts.' })
      const users = await readUsers()
      const user = users.find((item) => item.id === decodeURIComponent(userMatch[1]))
      if (!user) return send(res, 404, { error: 'Account not found.' })
      if (user.id === currentUser.id) return send(res, 400, { error: 'You cannot delete the administrator account you are currently using.' })
      if (user.role === 'admin' && users.filter((item) => item.role === 'admin').length <= 1) return send(res, 400, { error: 'The last administrator account cannot be deleted.' })
      await saveUsers(users.filter((item) => item.id !== user.id))
      for (const [token, sessionUser] of sessions) if (sessionUser.id === user.id) sessions.delete(token)
      return send(res, 200, { ok: true, id: user.id })
    }
    if (url.pathname === '/api/users') {
      const currentUser = authenticatedUser(req)
      if (!currentUser) return send(res, 401, { error: 'Please sign in first.' })
      if (currentUser.role !== 'admin') return send(res, 403, { error: 'Only an administrator can manage accounts.' })
      const users = await readUsers()
      if (req.method === 'GET') return send(res, 200, users.map(publicUser))
      if (req.method === 'POST') {
        const body = await readBody(req)
        const name = String(body.name || '').trim()
        const loginId = String(body.loginId || '').trim()
        const password = String(body.password || '')
        const role = String(body.role || '')
        const category = String(body.category || '')
        const requesterType = String(body.requesterType || '')
        const department = String(body.department || '')
        if (!name || !/^[A-Za-z0-9]{3,24}$/.test(loginId) || password.length < 8 || !['team', 'requester'].includes(role)) return send(res, 400, { error: 'Enter a name, a Login ID with 3–24 letters or numbers, a password with at least 8 characters, and account type.' })
        if (role === 'team' && (!teamCategories.includes(category) || !departments.includes(department))) return send(res, 400, { error: 'Choose a service category and department for this worker.' })
        if (role === 'requester' && (!requesterTypes.includes(requesterType) || (requesterType !== 'other_staff' && !departments.includes(department)))) return send(res, 400, { error: 'Choose a requester type and a valid department when required.' })
        if (users.some((item) => String(item.loginId || item.email || '').toLowerCase() === loginId.toLowerCase())) return send(res, 409, { error: 'An account with this Login ID already exists.' })
        const salt = randomBytes(16).toString('hex')
        const user = { id: randomUUID(), name, loginId, email: '', role, category: role === 'team' ? category : null, requesterType: role === 'requester' ? requesterType : null, department: role === 'team' || (role === 'requester' && requesterType !== 'other_staff') ? department : null, salt, passwordHash: passwordHash(password, salt), created: timeNow() }
        users.push(user)
        await saveUsers(users)
        return send(res, 201, publicUser(user))
      }
      return send(res, 405, { error: 'Method not allowed.' })
    }
    const currentUser = authenticatedUser(req)
    if (!currentUser) return send(res, 401, { error: 'Please sign in first.' })
      const cases = await readCases()
    if (req.method === 'GET' && url.pathname === '/api/requests') {
      if (currentUser.role === 'requester') return send(res, 200, cases.filter((item) => item.requester.toLowerCase() === currentUser.name.toLowerCase()))
      if (currentUser.role === 'team') {
        if (!currentUser.department) return send(res, 200, [])
        return send(res, 200, cases.filter((item) => workerCanHandle(currentUser, item)))
      }
      return send(res, 200, cases)
    }
    if (req.method === 'POST' && url.pathname === '/api/requests') {
      if (currentUser.role !== 'requester') return send(res, 403, { error: 'Only requesters can create requests.' })
      const body = await readBody(req)
      const title = String(body.title || '').trim()
      const requester = currentUser.name
      const description = String(body.description || '').trim()
      const clientRequestId = String(body.clientRequestId || '').trim()
      // Offline retries reuse this ID so a lost response cannot create a second case.
      if (clientRequestId) {
        const alreadyCreated = cases.find((item) => item.clientRequestId === clientRequestId)
        if (alreadyCreated) return send(res, 200, alreadyCreated)
      }
      const requestDetails = description || title
      const requestDepartment = currentUser.department || (currentUser.requesterType === 'other_staff' && departments.includes(body.department) ? body.department : null)
      if (!title || !requester) return send(res, 400, { error: 'A request title is required.' })
      if (!departments.includes(requestDepartment)) return send(res, 400, { error: currentUser.requesterType === 'other_staff' ? 'Choose a department for routing this request.' : 'Your account has no assigned department. Ask an administrator to update it before submitting a request.' })
      const duplicate = cases.find((item) => item.title.toLowerCase() === title.toLowerCase() && item.requester.toLowerCase() === requester.toLowerCase() && item.status !== 'Completed')
      if (duplicate) return send(res, 409, { error: `Possible duplicate: ${duplicate.id} is already open.`, duplicateId: duplicate.id })
      const users = await readUsers()
      const classification = await classifyIssue(title, description)
      // When the AI is unavailable and the local classifier cannot identify a category,
      // default to Network issue. Clear local keyword matches keep their original category.
      const category = classification.source === 'keyword-fallback' && classification.category === 'Other'
        ? 'Network issue'
        : classification.category
      const assignedWorker = chooseWorkerForDepartment(requestDepartment, users, cases, category)
      if (!assignedWorker) return send(res, 409, { error: `No worker is set up for ${requestDepartment}. Ask an administrator to add a worker in that department.` })
      const needsApproval = category === 'Hardware' || category === 'Account access' || category === 'Electrical'
      const missing = requestDetails.length < 15 ? 'Please add a little more detail so the team can process this safely.' : ''
      const number = Math.max(2048, ...cases.map((item) => Number(item.id.replace('SD-', '')) || 0)) + 1
      const team = `${requestDepartment} Department Team`
      const created = `Today, ${timeNow()}`
      const classificationLog = classification.source === 'keyword-fallback' && classification.category === 'Other' && category === 'Network issue'
        ? 'AI classification was unavailable and local classification was unclear; defaulted to Network issue and routed within the requester department.'
        : classification.source === 'deberta-v3'
        ? `DeBERTa-v3 AI classified this request as ${category} (${Math.round(classification.score * 100)}% confidence).`
        : `Request classified as ${category} using the local keyword fallback${process.env.HF_TOKEN ? ' because the AI service was unavailable' : ' because HF_TOKEN is not configured'}.`
      const routingLog = `Assigned to ${assignedWorker.name} in ${requestDepartment}; the AI classified the issue as ${category}.`
      const item = { id: `SD-${number}`, clientRequestId: clientRequestId || undefined, title, requester, email: currentUser.email, department: requestDepartment, assignedWorkerId: assignedWorker.id, assignedWorkerName: assignedWorker.name, category, classificationSource: classification.source, classificationConfidence: classification.score, priority: body.priority || 'Medium', status: missing ? 'Needs information' : needsApproval ? 'Awaiting approval' : 'Requested', team, created, description: requestDetails, missing, needsApproval, actionDone: false, demoFailurePending: false, logs: [makeLog(missing ? 'Required details are missing. Follow-up requested.' : needsApproval ? 'Policy requires manager approval before action.' : 'Request submitted and waiting for team review.', missing || needsApproval ? 'warning' : 'success'), makeLog(routingLog, 'success'), makeLog(classificationLog)] }
      cases.unshift(item)
      await saveCases(cases)
      return send(res, 201, item)
    }
    const deleteRequestMatch = url.pathname.match(/^\/api\/requests\/(SD-\d+)$/)
    if (req.method === 'DELETE' && deleteRequestMatch) {
      const itemIndex = cases.findIndex((entry) => entry.id === deleteRequestMatch[1])
      if (itemIndex < 0) return send(res, 404, { error: 'Request not found.' })
      const item = cases[itemIndex]
      if (currentUser.role === 'requester' && item.requester.toLowerCase() !== currentUser.name.toLowerCase()) return send(res, 403, { error: 'You can only delete your own requests.' })
      if (currentUser.role === 'team') {
        if (!workerCanHandle(currentUser, item)) return send(res, 403, { error: 'You can only delete requests from your department.' })
      } else if (!['requester', 'admin'].includes(currentUser.role)) {
        return send(res, 403, { error: 'You do not have permission to delete requests.' })
      }
      cases.splice(itemIndex, 1)
      await saveCases(cases)
      return send(res, 200, { ok: true, id: item.id })
    }
    const match = url.pathname.match(/^\/api\/requests\/(SD-\d+)\/(ongoing|approve|action|retry)$/)
    if (req.method === 'POST' && match) {
      if (currentUser.role !== 'team') return send(res, 403, { error: 'Only workers can run case actions.' })
      const [, id, operation] = match
      const item = cases.find((entry) => entry.id === id)
      if (!item) return send(res, 404, { error: 'Request not found.' })
      if (!workerCanHandle(currentUser, item)) return send(res, 403, { error: 'This request belongs to a different department.' })
      if (operation === 'ongoing') {
        if (item.status !== 'Requested' || item.missing || item.needsApproval) return send(res, 409, { error: 'Only a complete request that is ready for work can be marked ongoing.' })
        item.status = 'Ongoing'
        item.logs.unshift(makeLog('Worker started working on this request.', 'success'))
      } else if (operation === 'approve') {
        if (item.status !== 'Awaiting approval') return send(res, 409, { error: 'This request is not awaiting approval.' })
        item.status = 'Completed'; item.actionDone = true
        item.logs.unshift(makeLog('Approval recorded. Mock device setup action completed.', 'success'))
      } else if (operation === 'action') {
        if (item.actionDone || item.status === 'Completed') return send(res, 409, { error: 'This action has already completed; duplicate execution prevented.' })
        if (item.missing || item.status === 'Needs information') return send(res, 409, { error: 'Required information is missing.' })
        if (item.needsApproval && item.status !== 'Completed') return send(res, 409, { error: 'Approval is required before this action can run.' })
        if (item.demoFailurePending) {
          item.demoFailurePending = false; item.status = 'Failed'
          item.logs.unshift(makeLog('Mock identity API is unavailable. No change was made; safe to retry.', 'warning'))
        } else {
          item.status = 'Completed'; item.actionDone = true
          item.logs.unshift(makeLog(`Mock ${item.category.toLowerCase()} action completed successfully.`, 'success'))
        }
      } else {
        if (item.status !== 'Failed' || item.actionDone) return send(res, 409, { error: 'Only a failed, unfinished action can be retried.' })
        item.status = 'Completed'; item.actionDone = true
        item.logs.unshift(makeLog('Retry succeeded. Mock action completed; no duplicate change was made.', 'success'))
      }
      await saveCases(cases)
      return send(res, 200, item)
    }
    send(res, 404, { error: 'Route not found.' })
  } catch (error) {
    console.error('Service desk API error:', error)
    send(res, 500, { error: error instanceof SyntaxError ? 'Invalid JSON request body.' : 'The service desk server encountered an error.' })
  }
})

server.listen(port, '0.0.0.0', () => console.log(`Innovate X backend ready on LAN port ${port} (local: http://localhost:${port})`))



