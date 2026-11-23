#!/usr/bin/env node
// Converge one Sink instance to instances/<instance>/links.json, then verify it.
//   SINK_SITE_TOKEN=... node scripts-solvetus/sync-links.mjs <instance> [--verify-only]
// Prints slug, action and HTTP status only. The token is read from the environment,
// sent as a Bearer header, and never printed or logged. Never deletes: removing a
// link is a deliberate act (POST /api/link/delete), not a missing line.
import { readFileSync } from 'node:fs'

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ALLOWED = new Set(['slug', 'url'])
const instance = process.argv[2]
const verifyOnly = process.argv.includes('--verify-only')
if (!instance) { console.error('usage: sync-links.mjs <instance> [--verify-only]'); process.exit(2) }

const cfg = JSON.parse(readFileSync(new URL(`../instances/${instance}/links.json`, import.meta.url), 'utf8'))
const base = cfg.base.replace(/\/$/, '')
const token = process.env.SINK_SITE_TOKEN
if (!verifyOnly && !token) { console.error('SINK_SITE_TOKEN is not set'); process.exit(2) }

// 1. Validate the file: conventions + only plain redirects (no password, warning
//    page, cloaking, OpenGraph, geo, app or proxy fields: those stay off).
const problems = []
const seen = new Set()
for (const l of cfg.links) {
  for (const k of Object.keys(l)) if (!ALLOWED.has(k)) problems.push(`${l.slug}: field "${k}" is not allowed`)
  if (!SLUG.test(l.slug)) problems.push(`${l.slug}: slug must be lowercase-hyphen`)
  if (seen.has(l.slug)) problems.push(`${l.slug}: duplicate slug`)
  seen.add(l.slug)
  let u
  try { u = new URL(l.url) } catch { problems.push(`${l.slug}: url is not a URL`); continue }
  if (u.protocol !== 'https:') problems.push(`${l.slug}: url must be https`)
  if (u.searchParams.get('utm_source') !== cfg.utm_source) problems.push(`${l.slug}: utm_source must be ${cfg.utm_source}`)
  if (u.searchParams.get('utm_medium') !== 'referral') problems.push(`${l.slug}: utm_medium must be referral`)
  if (!u.searchParams.get('utm_campaign')) problems.push(`${l.slug}: utm_campaign is required`)
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1) }

const api = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    redirect: 'manual',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let data = null
  try { data = await res.json() } catch {}
  return { status: res.status, data }
}

let failed = 0
const fail = (msg) => { failed++; console.error(`FAIL ${msg}`) }

if (!verifyOnly) {
  // 2. One-time storage init (a fresh Sink answers 423 on link routes until it ran).
  const st = await api('GET', '/api/link/migration/status')
  if (st.status !== 200) { console.error(`migration status: HTTP ${st.status}`); process.exit(1) }
  if (!st.data?.completed) {
    let cursor
    for (let i = 0; i < 50; i++) {
      const r = await api('POST', '/api/link/migration/run', cursor ? { cursor } : {})
      if (r.status !== 200 || r.data?.failed) { console.error(`migration run: HTTP ${r.status}`); process.exit(1) }
      if (r.data.completed) break
      cursor = r.data.cursor
    }
    console.log('storage initialised')
  }

  // 3. Create, or edit when the destination differs.
  for (const { slug, url } of cfg.links) {
    const q = await api('GET', `/api/link/query?slug=${encodeURIComponent(slug)}`)
    if (q.status === 404) {
      const r = await api('POST', '/api/link/create', { slug, url })
      r.status === 201 ? console.log(`${slug}: created (${r.status})`) : fail(`${slug}: create HTTP ${r.status}`)
    } else if (q.status === 200) {
      if (q.data?.url === url) { console.log(`${slug}: unchanged`); continue }
      const r = await api('PUT', '/api/link/edit', { slug, url })
      r.status === 201 ? console.log(`${slug}: updated (${r.status})`) : fail(`${slug}: edit HTTP ${r.status}`)
    } else fail(`${slug}: query HTTP ${q.status}`)
  }
}

// 4. Verify what a visitor gets: 302, exact Location, no cookie, not cacheable.
for (const { slug, url } of cfg.links) {
  const res = await fetch(`${base}/${slug}`, { redirect: 'manual' })
  const loc = res.headers.get('location')
  const bad = []
  if (res.status !== 302) bad.push(`status ${res.status}`)
  if (loc !== url) bad.push('Location differs')
  if (res.headers.get('set-cookie')) bad.push('Set-Cookie present')
  if (!/no-store/.test(res.headers.get('cache-control') || '')) bad.push('not no-store')
  bad.length ? fail(`${slug}: ${bad.join(', ')}`) : console.log(`${slug}: 302 ok`)
}

process.exit(failed ? 1 : 0)
