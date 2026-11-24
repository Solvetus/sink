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
| `.github/workflows/release.yml` | GitHub Release from the annotated tag message |

## Add a link
Add one line to `instances/<instance>/links.json` (slug lowercase-hyphen, vendor first; URL with
`utm_source`, `utm_medium=referral`, `utm_campaign`), push to `master`. Deploy, then the link sync, run by themselves.

## Sync with upstream
`gh repo sync Solvetus/sink --source miantiao-me/Sink` (or the Sync fork button), read the release notes, diff upstream's
`wrangler.jsonc` against ours for new bindings or config, let CI deploy, check the run is green. Tags: `v<upstream>-solvetus.<N>`.

## New instance (for example go.aeiodoo.com)
Copy `wrangler.go-solvetus.jsonc` and `instances/go-solvetus/`, rename every resource `sink-<subdomain>-<domain>-…`,
add a GitHub Environment of the same name (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_D1_API_TOKEN`, `SINK_SITE_TOKEN` secrets; `CLOUDFLARE_ACCOUNT_ID` variable). The deploy token never carries D1; `CLOUDFLARE_D1_API_TOKEN` is mapped into the migrate step only,
and add the instance to both workflow matrices.

Full standard, decisions and token register: the Solvetus vault, `Affiliate Links Standard`.
