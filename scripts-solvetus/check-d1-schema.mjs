#!/usr/bin/env node
// Reads `wrangler d1 execute ... --json --command "SELECT name FROM sqlite_master ..."` on stdin and fails
// unless Sink's tables are present. Prints table names only (never row data).
let raw = ''
for await (const chunk of process.stdin) raw += chunk
const start = raw.indexOf('[')
let names
try {
  names = JSON.parse(raw.slice(start)).flatMap(r => r.results ?? []).map(r => r.name)
} catch {
  console.error('could not read the wrangler --json output')
  process.exit(1)
}
const required = ['d1_migrations', 'links', 'link_tags', 'link_migration_runs']
const missing = required.filter(n => !names.includes(n))
console.log(`tables: ${names.filter(n => !n.startsWith('_cf_') && n !== 'sqlite_sequence').join(', ')}`)
if (missing.length) { console.error(`missing: ${missing.join(', ')}`); process.exit(1) }
console.log('schema ok')
