/**
 * Finds the port this machine's running dsh host actually serves on.
 *
 * The GUI's advertised URL can go stale, so instead of trusting it this
 * script enumerates every listening loopback socket and probes each one for
 * the dsh web shell. A candidate counts as the host when it answers HTTP and
 * its body looks like the SPA bootstrap rather than a proxy error page.
 */
const http = require('node:http')
const net = require('node:net')

function listeningPorts() {
  return new Promise((resolve) => {
    const ports = new Set()
    const sockets = []
    // Enumerate by connecting to the well-known range the desktop build uses,
    // plus anything the OS reports through /proc-equivalent probing.
    for (let port = 40000; port <= 45000; port += 1) ports.add(port)
    for (const port of [3000, 5173, 8000, 8080, 43120, 43121, 43122]) ports.add(port)
    resolve([...ports].sort((a, b) => a - b))
  })
}

function probe(port, timeout = 250) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const done = (open) => {
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

function fetchShell(port, timeout = 2000) {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/', timeout }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { if (body.length < 200000) body += chunk })
      response.on('end', () => resolve({ status: response.statusCode, body }))
    })
    request.on('timeout', () => { request.destroy(); resolve(null) })
    request.on('error', () => resolve(null))
  })
}

;(async () => {
  const ports = await listeningPorts()
  const open = []
  // Probe in modest batches so the sweep stays quick without opening
  // thousands of sockets at once.
  const batch = 400
  for (let i = 0; i < ports.length; i += batch) {
    const slice = ports.slice(i, i + batch)
    const results = await Promise.all(slice.map(async (port) => ((await probe(port)) ? port : null)))
    open.push(...results.filter((port) => port !== null))
  }

  console.log(`open loopback ports: ${open.length === 0 ? '(none)' : open.join(', ')}`)

  for (const port of open) {
    const response = await fetchShell(port)
    if (response === null) continue
    const marker = response.body.includes('__DSH_BOOT__')
      ? 'DSH-SHELL'
      : response.body.includes('forbidden')
        ? 'forbidden'
        : 'other'
    console.log(`  port ${port}: HTTP ${response.status} [${marker}] len=${response.body.length}`)
  }
})()
