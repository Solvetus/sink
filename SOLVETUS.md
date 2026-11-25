# Solvetus fork of Sink

Fork of [miantiao-me/Sink](https://github.com/miantiao-me/Sink) (AGPL-3.0), kept in sync with upstream.
**Configuration, plus one small code patch (click-record minimisation, below).** Apart from the two lines that patch adds to `server/utils/access-log.ts`, no upstream file is edited, so syncing stays easy. The AGPL source of what we
run is this repository.

**One exception (2026-11-24):** upstream's `.github/workflows/issue-assistant.yml` is **deleted here**. It ran `oven-sh/setup-bun` and `curl | bash` with an API key in a public repo, and our rule is no third-party action in any workflow (the organisation allows only GitHub's own actions). Issues are off and it was already disabled. If a sync reports a conflict on that file, delete it again.

## What is ours
| File | Purpose |
|---|---|
| `wrangler.<instance>.jsonc` | Worker, bindings and every setting for one instance (`go-solvetus` = go.solvetus.com) |
| `instances/<instance>/links.json` | The links of that instance, as code |
| `scripts-solvetus/sync-links.mjs` | Creates or edits links through Sink's API, then checks each answers 302 |
| `scripts-solvetus/link-rules.mjs` | The rules every `links.json` entry must meet, offline, with a self-test the `Links` workflow runs first |
| `server/utils/solvetus-click-record.ts` + `tests/unit/solvetus-click-record.spec.ts` | The click-record minimiser and its self-test (the one code divergence, below) |
| `.github/workflows/deploy.yml` | The only deployer (Workers Builds stays off); runs the minimisation self-test after the build |
| `.github/workflows/links.yml` | Runs the sync after every successful deploy |
| `.github/workflows/kv-check.yml` + `scripts-solvetus/check-kv.mjs` | Manual: proves the Worker reads and writes the EU-jurisdiction KV through its binding |
| `.github/workflows/release.yml` | GitHub Release from the annotated tag message |

## Add a link
Add one line to `instances/<instance>/links.json` (slug lowercase-hyphen, vendor first), push to `master`. Deploy, then the link
sync, run by themselves. The destination is one of three kinds (`scripts-solvetus/link-rules.mjs`, self-test `node scripts-solvetus/link-rules.mjs --self-test`):
- **an Odoo affiliate redirect, exactly `https://www.odoo.com/r/<code>` with no query string.** Odoo's own redirect adds its
  tracking and pays the commission, so our UTMs are not added (a query string there could overwrite it and is refused);
- **a Nord Security affiliate link, exactly `https://go.nordpass.io/aff_c?…` or `https://go.nordvpn.net/aff_c?…`** with `offer_id` and
  `aff_id`, **verbatim: no `utm_*` parameter, no fragment** (affiliate links are never modified; Nord's platform is affiliates.nordvpn.com);
- **anything else:** https with `utm_source`, `utm_medium=referral` and `utm_campaign`.

## Automation never clicks a vendor link
Sink records every request to a short link as a visit (here minimised: link, time, country, coarse device/browser/OS family and referring domain, see below). Its bot detection only recognises real
crawlers (Googlebot and the like), **not** curl, Node, browsers or a custom user agent (tested 2026-11-24), so a check cannot hide behind a user
agent, and we never impersonate a crawler. Therefore:
- `sync-links.mjs` verifies stored links **through the API** (no click) and tests the real redirect on **one canary link only**:
  `canary` in `links.json` (`link-check` → `https://solvetus.com/…`), whose clicks are test traffic to ignore in the stats.
- Vendor links are probed only by hand, when asked; those clicks are test data too (Analytics Engine keeps them for three months).
- `kv-check.yml` is manual and its probe is one click under the slug `kv-probe`.
- The site's own gate (`scripts/go-links-check.mjs` in solvetus-COM-www) reads this repo's public `links.json` instead of calling the domain.

## The one code divergence: minimised click records (S12, 2026-11-25, audit H11)
Upstream writes every click to Workers Analytics Engine with the raw IP, full User-Agent, region, city, coordinates, time zone, language and data centre. Decision (Ruben): go.solvetus.com stores only what counting clicks needs, so "IP never stored" holds on every Solvetus service.
- **What is written:** slug, destination URL (ours), the time (added by Analytics Engine), country (`request.cf`), OS family, browser family, browser type, device type (all parsed from the User-Agent in memory; the string itself is never stored), and the referring **domain** only (lowercase, no port or path, blank if an IP literal).
- **What is dropped (empty / 0, so the record shape the dashboard queries expect is unchanged):** IP, User-Agent, region, city, time zone, language, device model, data centre, latitude, longitude. Webhook payloads carry no region/city either.
- **How:** `server/utils/solvetus-click-record.ts` is an **allowlist** (a field upstream adds later is dropped by default). `collectAccessLog` in `server/utils/access-log.ts` returns `minimiseAccessLog({...})`: one import and one wrapper, the only upstream edit. The blob layout, `writeAccessLog` and every query are untouched.
- **Self-test:** `tests/unit/solvetus-click-record.spec.ts` fails if a written record holds an IPv4/IPv6 value, a slice of the User-Agent, `Mozilla/`, the city/region/time zone/colo, or a non-zero coordinate; the Deploy workflow runs it after the build.
- **Dashboard views that degrade (accepted):** the Visitors counter and visitors series (they count distinct IPs, so about 1; Visits stay exact), the realtime globe and the Locations map (no coordinates), region/city, language/time zone and device-model breakdowns, the realtime log's ip/ua columns, and the export's `viewer` column. Visits, views over time, heatmap, referrers, country, OS, browser and device type keep working.
- **Existing data:** Analytics Engine data points cannot be edited. Cloudflare keeps them "for three months" (limits page), so records written before the patch (with IPs) are gone by **2027-02-26**.
- **After an upstream sync:** run `pnpm vitest --run tests/unit/solvetus-click-record.spec.ts`. If upstream changed `collectAccessLog`, re-apply the one-line wrapper. If upstream adds a field, the allowlist already drops it; extend the test's expectations only on purpose.

## Sync with upstream
`gh repo sync Solvetus/sink --source miantiao-me/Sink` (or the Sync fork button), read the release notes, diff upstream's
`wrangler.jsonc` against ours for new bindings or config, let CI deploy, check the run is green. Tags: `v<upstream>-solvetus.<N>`.

## New instance (for example go.aeiodoo.com)
Copy `wrangler.go-solvetus.jsonc` and `instances/go-solvetus/`, rename every resource `sink-<subdomain>-<domain>-…`,
add a GitHub Environment of the same name (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_D1_API_TOKEN`, `SINK_SITE_TOKEN` secrets; `CLOUDFLARE_ACCOUNT_ID` variable). The deploy token never carries D1; `CLOUDFLARE_D1_API_TOKEN` is mapped into the migrate step only,
and add the instance to both workflow matrices.

Full standard, decisions and token register: the Solvetus vault, `Affiliate Links Standard`.
