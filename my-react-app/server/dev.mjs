import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const viteCli = resolve(root, 'node_modules', 'vite', 'bin', 'vite.js')
const backendCli = resolve(root, 'backend-v2', 'server.mjs')
const children = []
const backendIsRunning = await fetch('http://localhost:4001/api/health')
  .then((response) => response.ok)
  .catch(() => false)
if (!backendIsRunning) children.push(spawn(process.execPath, [backendCli], { cwd: root, stdio: 'inherit' }))
children.push(spawn(process.execPath, [viteCli, '--configLoader', 'native'], { cwd: root, stdio: 'inherit' }))
let stopping = false
function stop() {
  if (stopping) return
  stopping = true
  for (const child of children) if (!child.killed) child.kill()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const child of children) child.on('exit', (code) => {
  if (!stopping && code !== 0) stop()
})
