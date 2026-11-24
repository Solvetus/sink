# Solvetus fork of Sink

Fork of [miantiao-me/Sink](https://github.com/miantiao-me/Sink) (AGPL-3.0), kept in sync with upstream.
**Configuration only: no upstream file is edited**, so syncing never conflicts. The AGPL source of what we
run is this repository.

## What is ours
| File | Purpose |
|---|---|
| `wrangler.<instance>.jsonc` | Worker, bindings and every setting for one instance (`go-solvetus` = go.solvetus.com) |
| `instances/<instance>/links.json` | The links of that instance, as code |
| `scripts-solvetus/sync-links.mjs` | Creates or edits links through Sink's API, then checks each answers 302 |
| `.github/workflows/deploy.yml` | The only deployer (Workers Builds stays off) |
| `.github/workflows/links.yml` | Runs the sync after every successful deploy |
| `.github/workflows/kv-check.yml` + `scripts-solvetus/check-kv.mjs` | Manual: proves the Worker reads and writes the EU-jurisdiction KV through its binding |
| `.github/workflows/release.yml` | GitHub Release from the annotated tag message |

## Add a link
Add one line to `instances/<instance>/links.json` (slug lowercase-hyphen, vendor first; URL with
`utm_source`, `utm_medium=referral`, `utm_campaign`), push to `master`. Deploy, then the link sync, run by themselves.

## Automation never clicks a vendor link
Sink records every request to a short link as a visitor (IP, user agent, location, ...). Its bot detection only recognises real
crawlers (Googlebot and the like), **not** curl, Node, browsers or a custom user agent (tested 2026-11-24), so a check cannot hide behind a user
agent, and we never impersonate a crawler. Therefore:
- `sync-links.mjs` verifies stored links **through the API** (no click) and tests the real redirect on **one canary link only**:
  `canary` in `links.json` (`link-check` → `https://solvetus.com/…`), whose clicks are test traffic to ignore in the stats.
- Vendor links are probed only by hand, when asked; those clicks are test data too (Analytics Engine keeps them for three months).
- `kv-check.yml` is manual and its probe is one click under the slug `kv-probe`.
- The site's own gate (`scripts/go-links-check.mjs` in solvetus-COM-www) reads this repo's public `links.json` instead of calling the domain.

## Sync with upstream
`gh repo sync Solvetus/sink --source miantiao-me/Sink` (or the Sync fork button), read the release notes, diff upstream's
`wrangler.jsonc` against ours for new bindings or config, let CI deploy, check the run is green. Tags: `v<upstream>-solvetus.<N>`.

## New instance (for example go.aeiodoo.com)
Copy `wrangler.go-solvetus.jsonc` and `instances/go-solvetus/`, rename every resource `sink-<subdomain>-<domain>-…`,
add a GitHub Environment of the same name (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_D1_API_TOKEN`, `SINK_SITE_TOKEN` secrets; `CLOUDFLARE_ACCOUNT_ID` variable). The deploy token never carries D1; `CLOUDFLARE_D1_API_TOKEN` is mapped into the migrate step only,
and add the instance to both workflow matrices.

Full standard, decisions and token register: the Solvetus vault, `Affiliate Links Standard`.
