#!/usr/bin/env node
// Proves the Worker reads and writes the KV namespace through its binding (the namespace is in the EU
// jurisdiction; the docs say nothing about bindings there, so it is checked, not assumed).
//   CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / WRANGLER_VERSION in the environment.
//   node scripts-solvetus/check-kv.mjs <instance>
// WRITE: after a links sync, KV holds a `link:<slug>` key per link, put there by the Worker's write-through.
// READ:  a throwaway KV-only key (no D1 row) is put straight into the namespace; the Worker must redirect
//        on it, which it can only do by reading KV. The key has a 120 s TTL and is deleted at the end.
// Prints key names and statuses only, never values or tokens.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const instance = process.argv[2]
if (!instance || !/^[a-z0-9-]+$/.test(instance)) { console.error('usage: check-kv.mjs <instance> (lowercase letters, digits, hyphens)'); process.exit(2) }
const version = process.env.WRANGLER_VERSION
if (!version) { console.error('WRANGLER_VERSION is not set'); process.exit(2) }

const wranglerFile = new URL(`../wrangler.${instance}.jsonc`, import.meta.url)
const id = readFileSync(wranglerFile, 'utf8').match(/"binding"\s*:\s*"KV"\s*,\s*"id"\s*:\s*"([0-9a-f]{32})"/)?.[1]
if (!id) { console.error('no KV namespace id (32 hex) in the wrangler config'); process.exit(1) }
const { base, links } = JSON.parse(readFileSync(new URL(`../instances/${instance}/links.json`, import.meta.url), 'utf8'))

const wrangler = (...args) => execFileSync('npx', ['--yes', `wrangler@${version}`, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const probeKey = 'link:kv-probe'
const probeUrl = 'https://solvetus.com/kv-probe-ok'
let failed = 0
const fail = (m) => { failed++; console.error(`FAIL ${m}`) }

try {
  // WRITE
  const raw = wrangler('kv', 'key', 'list', '--namespace-id', id, '--remote', '--prefix', 'link:')
  const keys = new Set(JSON.parse(raw.slice(raw.indexOf('['))).map(k => k.name))
  for (const { slug } of links) {
    keys.has(`link:${slug}`) ? console.log(`write ok: link:${slug} is in KV`) : fail(`link:${slug} is not in KV`)
  }

  // READ
  wrangler('kv', 'key', 'put', probeKey, JSON.stringify({ url: probeUrl }), '--namespace-id', id, '--remote', '--ttl', '120')
  let seen
  for (let i = 0; i < 12; i++) {
    const res = await fetch(`${base}/kv-probe`, { redirect: 'manual' })
    seen = { status: res.status, location: res.headers.get('location'), cookie: !!res.headers.get('set-cookie') }
    if (seen.location === probeUrl) break
    await new Promise(r => setTimeout(r, 5000))
  }
  if (seen.status === 302 && seen.location === probeUrl && !seen.cookie) console.log('read ok: the Worker redirected on a KV-only key')
  else fail(`read: status ${seen.status}, location ${seen.location === probeUrl ? 'ok' : 'wrong'}, cookie ${seen.cookie}`)
}
catch (error) {
  fail(`wrangler or fetch error: ${String(error.message ?? error).split('\n')[0]}`)
}
finally {
  try { wrangler('kv', 'key', 'delete', probeKey, '--namespace-id', id, '--remote') } catch {}
}
process.exit(failed ? 1 : 0)
