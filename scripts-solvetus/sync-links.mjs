#!/usr/bin/env node
// Converge one Sink instance to instances/<instance>/links.json, then verify it, WITHOUT clicking a real link.
//   SINK_SITE_TOKEN=... node scripts-solvetus/sync-links.mjs <instance> [--verify-only]
// Why no clicks: every request to a short link is recorded by Sink as a visitor (IP, user agent, ...), and Sink's
// bot detection does not recognise our tools (curl, Node, custom agents are all "visitors"; tested 2026-11-24).
// So automation NEVER requests a vendor link path:
//   - stored links are verified through the API (no click);
//   - the real redirect (302, exact Location, no cookie, no-store) is tested on ONE canary link only
//     (`canary` in links.json, pointing at our own site), whose clicks are filterable by slug.
// Prints slug, action and HTTP status only. The token is read from the environment, sent as a Bearer header, and
// never printed. Never deletes a link.
import { readFileSync } from 'node:fs'
import { linkProblems } from './link-rules.mjs'

const UA = 'solvetus-link-check/1.0 (+https://solvetus.com)'
const instance = process.argv[2]
const verifyOnly = process.argv.includes('--verify-only')
if (!instance || !/^[a-z0-9-]+$/.test(instance)) { console.error('usage: sync-links.mjs <instance> [--verify-only]'); process.exit(2) }

const cfg = JSON.parse(readFileSync(new URL(`../instances/${instance}/links.json`, import.meta.url), 'utf8'))
const base = cfg.base.replace(/\/$/, '')
const token = process.env.SINK_SITE_TOKEN
if (!verifyOnly && !token) { console.error('SINK_SITE_TOKEN is not set'); process.exit(2) }

// 1. Validate the file: conventions (scripts-solvetus/link-rules.mjs), only plain redirects, and a well-formed canary.
const problems = []
const seen = new Set()
for (const l of cfg.links) {
  problems.push(...linkProblems(l, cfg.utm_source))
  if (seen.has(l.slug)) problems.push(`${l.slug}: duplicate slug`)
  seen.add(l.slug)
}
const canary = cfg.links.find(l => l.slug === cfg.canary)
if (!canary) problems.push(`canary "${cfg.canary}" is not one of the links`)
else if (new URL(canary.url).hostname !== 'solvetus.com') problems.push('the canary must point at solvetus.com (our own site), never at a vendor')
if (problems.length) { console.error(problems.join('\n')); process.exit(1) }

const api = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    redirect: 'manual',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': UA },
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

  // 4a. Verify every stored link through the API: no click is made.
  for (const { slug, url } of cfg.links) {
    const q = await api('GET', `/api/link/query?slug=${encodeURIComponent(slug)}`)
    q.status === 200 && q.data?.url === url ? console.log(`${slug}: stored url matches`) : fail(`${slug}: stored url differs or is missing (HTTP ${q.status})`)
  }
}

// 4b. The real redirect, on the canary ONLY: 302, exact Location, no cookie, not cacheable.
{
  const res = await fetch(`${base}/${canary.slug}`, { redirect: 'manual', headers: { 'user-agent': UA } })
  const bad = []
  if (res.status !== 302) bad.push(`status ${res.status}`)
  if (res.headers.get('location') !== canary.url) bad.push('Location differs')
  if (res.headers.get('set-cookie')) bad.push('Set-Cookie present')
  if (!/no-store/.test(res.headers.get('cache-control') || '')) bad.push('not no-store')
  bad.length ? fail(`${canary.slug} (canary): ${bad.join(', ')}`) : console.log(`${canary.slug} (canary): 302 ok`)
}

process.exit(failed ? 1 : 0)
