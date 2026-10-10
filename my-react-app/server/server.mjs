import { createServer } from 'node:http'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const databaseFile = join(root, '..', 'data', 'cases.json')
const usersFile = join(root, '..', 'data', 'users.json')
const port = Number(process.env.API_PORT || 4000)
const sessions = new Map()
const teamCategories = ['Hardware', 'Software', 'Electrical', 'Networking', 'Cleaning', 'Water']
const requesterTypes = ['student', 'teaching_staff', 'other_staff']
const departments = ['CSE', 'IT', 'BIO-TECH', 'BIO-MEDICAL', 'CIVIL', 'MECH', 'AIDS', 'B.Ed', 'ECE', 'EEE']
const requestCategoryForTeam = { Networking: 'Network issue' }

const seedCases = [
  { id: 'SD-2048', title: 'Laptop access for new team member', requester: 'Priya Sharma', email: 'priya.sharma@acme.io', category: 'Hardware', priority: 'High', status: 'Awaiting approval', team: 'IT Operations', created: 'Today, 10:42 AM', description: 'A new design team member needs a company laptop configured with the approved design tools.', missing: '', needsApproval: true, actionDone: false, logs: [{ time: '10:43 AM', text: 'Routed to IT Operations. Manager approval required.', type: 'success' }, { time: '10:42 AM', text: 'Request received and classified as Hardware.', type: 'info' }] },
  { id: 'SD-2047', title: 'Reset account password', requester: 'Marcus Lee', email: 'marcus.lee@acme.io', category: 'Account access', priority: 'Medium', status: 'In progress', team: 'Identity & Access', created: 'Today, 10:18 AM', description: 'Unable to sign in after a password change. Please help restore access.', missing: '', needsApproval: false, actionDone: false, demoFailurePending: true, logs: [{ time: '10:20 AM', text: 'Mock identity API timed out. Safe to retry.', type: 'warning' }, { time: '10:19 AM', text: 'Identity check started.', type: 'success' }, { time: '10:18 AM', text: 'Request received and classified as Account access.', type: 'info' }] },
  { id: 'SD-2046', title: 'Install analytics software', requester: 'Nina Patel', email: 'nina.patel@acme.io', category: 'Software', priority: 'Low', status: 'Needs information', team: 'Business Systems', created: 'Today, 9:56 AM', description: 'Please install the analytics application on my workstation.', missing: 'Please specify the application name and your device ID.', needsApproval: false, actionDone: false, logs: [{ time: '9:57 AM', text: 'Missing required details. Follow-up requested.', type: 'warning' }, { time: '9:56 AM', text: 'Request received and classified as Software.', type: 'info' }] },
  { id: 'SD-2045', title: 'VPN access for remote work', requester: 'Jordan Kim', email: 'jordan.kim@acme.io', category: 'Account access', priority: 'Medium', status: 'Completed', team: 'Identity & Access', created: 'Today, 9:31 AM', description: 'Enable the standard VPN profile for my approved remote work setup.', missing: '', needsApproval: false, actionDone: true, logs: [{ time: '9:35 AM', text: 'VPN access provisioned successfully.', type: 'success' }, { time: '9:33 AM', text: 'Policy check passed. Request routed to Identity & Access.', type: 'success' }, { time: '9:31 AM', text: 'Request received and classified as Account access.', type: 'info' }] },
]

const timeNow = () => new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date())
function passwordHash(password, salt) { return scryptSync(password, salt, 64).toString('hex') }
function publicUser(user) { return { id: user.id, name: user.name, email: user.email, role: user.role, category: user.category || null, requesterType: user.requesterType || null, department: user.department || null, created: user.created } }
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
    const demo = [
      { name: 'Alex Morgan', email: 'team@innovatex.demo', password: 'team123', role: 'team', category: 'all' },
      { name: 'Marcus Lee', email: 'requester@innovatex.demo', password: 'request123', role: 'requester', requesterType: 'student', department: 'CSE' },
      { name: 'Innovate X Admin', email: 'admin@innovatex.demo', password: 'admin123', role: 'admin' },
    ].map((account) => {
      const salt = randomBytes(16).toString('hex')
      return { id: randomUUID(), name: account.name, email: account.email, role: account.role, category: account.category || null, requesterType: account.requesterType || null, department: account.department || null, salt, passwordHash: passwordHash(account.password, salt), created: `Oct 9, 2026` }
    })
    await writeFile(usersFile, JSON.stringify(demo, null, 2))
    return demo
  }
}
async function saveUsers(users) {
  await mkdir(dirname(usersFile), { recursive: true })
  await writeFile(usersFile, JSON.stringify(users, null, 2))
}
function authenticatedUser(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  return token ? sessions.get(token) : null
}
async function readCases() {
  try {
    const cases = JSON.parse(await readFile(databaseFile, 'utf8'))
    let changed = false
    for (const item of cases) {
      if (/^SD-204[5-8]$/.test(item.id) && !item.department) { item.department = 'CSE'; changed = true }
    }
    if (changed) await saveCases(cases)
    return cases
  }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    await mkdir(dirname(databaseFile), { recursive: true })
    const seeded = structuredClone(seedCases).map((item) => ({ ...item, department: 'CSE' }))
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

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type,authorization' })
    return res.end()
  }
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, service: 'Innovate X Service Desk API' })
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const { email, password } = await readBody(req)
      const users = await readUsers()
      const user = users.find((item) => item.email.toLowerCase() === String(email || '').trim().toLowerCase())
      if (!user || !timingSafeEqual(Buffer.from(user.passwordHash, 'hex'), Buffer.from(passwordHash(String(password || ''), user.salt), 'hex'))) return send(res, 401, { error: 'Email or password is incorrect.' })
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
      const email = String(body.email || '').trim().toLowerCase()
      if (!name || !/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Enter a name and valid email address.' })
      if (users.some((item) => item.id !== user.id && item.email.toLowerCase() === email)) return send(res, 409, { error: 'Another account already uses this email.' })
      if (user.role === 'team' && (!teamCategories.includes(body.category) || !departments.includes(body.department))) return send(res, 400, { error: 'Choose a valid service category and department for this worker.' })
      if (user.role === 'requester' && (!requesterTypes.includes(body.requesterType) || (body.requesterType !== 'other_staff' && !departments.includes(body.department)))) return send(res, 400, { error: 'Choose a requester type and a valid department when required.' })
      user.name = name
      user.email = email
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
        const email = String(body.email || '').trim().toLowerCase()
        const password = String(body.password || '')
        const role = String(body.role || '')
        const category = String(body.category || '')
        const requesterType = String(body.requesterType || '')
        const department = String(body.department || '')
        if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || !['team', 'requester'].includes(role)) return send(res, 400, { error: 'Enter a name, valid email, password with at least 8 characters, and account type.' })
        if (role === 'team' && (!teamCategories.includes(category) || !departments.includes(department))) return send(res, 400, { error: 'Choose a service category and department for this worker.' })
        if (role === 'requester' && (!requesterTypes.includes(requesterType) || (requesterType !== 'other_staff' && !departments.includes(department)))) return send(res, 400, { error: 'Choose a requester type and a valid department when required.' })
        if (users.some((item) => item.email.toLowerCase() === email)) return send(res, 409, { error: 'An account with this email already exists.' })
        const salt = randomBytes(16).toString('hex')
        const user = { id: randomUUID(), name, email, role, category: role === 'team' ? category : null, requesterType: role === 'requester' ? requesterType : null, department: role === 'team' || (role === 'requester' && requesterType !== 'other_staff') ? department : null, salt, passwordHash: passwordHash(password, salt), created: timeNow() }
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
        const requestCategory = requestCategoryForTeam[currentUser.category] || currentUser.category
        return send(res, 200, cases.filter((item) => item.department === currentUser.department && (!currentUser.category || currentUser.category === 'all' || item.category === requestCategory)))
      }
      return send(res, 200, cases)
    }
    if (req.method === 'POST' && url.pathname === '/api/requests') {
      if (currentUser.role !== 'requester') return send(res, 403, { error: 'Only requesters can create requests.' })
      const body = await readBody(req)
      const title = String(body.title || '').trim()
      const requester = currentUser.name
      const description = String(body.description || '').trim()
      const category = String(body.category || 'Other')
      const requestDepartment = currentUser.department || (departments.includes(body.department) ? body.department : null)
      if (!title || !requester || !description) return send(res, 400, { error: 'Title, requester, and details are required.' })
      if (!departments.includes(requestDepartment)) return send(res, 400, { error: 'Choose your department so the request reaches the correct team.' })
      const duplicate = cases.find((item) => item.title.toLowerCase() === title.toLowerCase() && item.requester.toLowerCase() === requester.toLowerCase() && item.status !== 'Completed')
      if (duplicate) return send(res, 409, { error: `Possible duplicate: ${duplicate.id} is already open.`, duplicateId: duplicate.id })
      const needsApproval = category === 'Hardware' || category === 'Account access' || category === 'Electrical'
      const missing = description.length < 15 ? 'Please add a little more detail so the team can process this safely.' : ''
      const number = Math.max(2048, ...cases.map((item) => Number(item.id.replace('SD-', '')) || 0)) + 1
      const team = `${requestDepartment} Department Team`
      const created = `Today, ${timeNow()}`
      const item = { id: `SD-${number}`, title, requester, email: currentUser.email, department: requestDepartment, category, priority: body.priority || 'Medium', status: missing ? 'Needs information' : needsApproval ? 'Awaiting approval' : 'In progress', team, created, description, missing, needsApproval, actionDone: false, demoFailurePending: false, logs: [makeLog(missing ? 'Required details are missing. Follow-up requested.' : needsApproval ? 'Policy requires manager approval before action.' : 'Request routed to the responsible team.', missing || needsApproval ? 'warning' : 'success'), makeLog(`Request received and classified as ${category}.`)] }
      cases.unshift(item)
      await saveCases(cases)
      return send(res, 201, item)
    }
    const match = url.pathname.match(/^\/api\/requests\/(SD-\d+)\/(approve|action|retry)$/)
    if (req.method === 'POST' && match) {
      if (currentUser.role !== 'team') return send(res, 403, { error: 'Only workers can run case actions.' })
      const [, id, operation] = match
      const item = cases.find((entry) => entry.id === id)
      if (!item) return send(res, 404, { error: 'Request not found.' })
      if (currentUser.department !== item.department) return send(res, 403, { error: 'This request belongs to a different department.' })
      if (currentUser.category && currentUser.category !== 'all' && item.category !== (requestCategoryForTeam[currentUser.category] || currentUser.category)) return send(res, 403, { error: 'This request belongs to a different service category.' })
      if (operation === 'approve') {
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
    send(res, 500, { error: error instanceof SyntaxError ? 'Invalid JSON request body.' : 'The service desk server encountered an error.' })
  }
})

server.listen(port, () => console.log(`Innovate X backend ready at http://localhost:${port}`))

