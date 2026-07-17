import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const diagnosticDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(diagnosticDirectory, '..', '..', '..')
const configPath = path.join(diagnosticDirectory, 'wrangler.jsonc')
const fixturePath = path.join(repositoryRoot, 'public', 'na-club-logo.png')
const wranglerPath = path.join(repositoryRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const port = Number(process.env.MOONDREAM_DIAGNOSTIC_PORT ?? '8791')
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10]

function result(category, message, details = {}) {
  return { ok: false, category, message, ...details }
}

async function stopProcess(child) {
  if (child.exitCode !== null) return
  child.kill('SIGINT')
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ])
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function waitForReady(child, logs) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Wrangler did not become ready within 60 seconds.')), 60_000)
    const inspect = (chunk) => {
      const text = chunk.toString()
      logs.push(text)
      if (text.includes('Ready on')) {
        clearTimeout(timeout)
        resolve()
      }
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Wrangler exited before startup with code ${code ?? 'unknown'}.`))
    })
  })
}

let child
try {
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error('MOONDREAM_DIAGNOSTIC_PORT must be an integer from 1024 through 65535.')
  }
  const fixture = new Uint8Array(await readFile(fixturePath))
  if (fixture.length > 128 * 1024 || !pngSignature.every((byte, index) => fixture[index] === byte)) {
    throw new Error('The repository diagnostic fixture is not a valid small PNG.')
  }

  const logs = []
  child = spawn(process.execPath, [
    wranglerPath,
    'dev',
    '--config',
    configPath,
    '--port',
    String(port),
  ], {
    cwd: repositoryRoot,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  await waitForReady(child, logs)

  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: fixture,
  })
  const body = await response.json().catch(() => result('model', 'The diagnostic Worker returned non-JSON output.'))
  console.log(JSON.stringify(body, null, 2))
  if (!response.ok || body.ok !== true) process.exitCode = 1
} catch (error) {
  console.log(JSON.stringify(result(
    'configuration',
    error instanceof Error ? error.message : String(error),
  ), null, 2))
  process.exitCode = 2
} finally {
  if (child) await stopProcess(child)
}
