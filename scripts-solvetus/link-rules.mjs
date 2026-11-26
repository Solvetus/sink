#!/usr/bin/env node
// The rules every entry of instances/<instance>/links.json must meet. Pure and offline: no request is ever made.
//   node scripts-solvetus/link-rules.mjs --self-test      (run by the Links workflow before it syncs)
//
// A destination is one of three kinds:
//   1. an affiliate redirect of Odoo, exactly https://www.odoo.com/r/<code> with NO query string and no fragment.
//      Odoo's own redirect adds its tracking (utm_campaign=partner-..., utm_source=Affiliate, utm_medium=AFF...) and pays
//      the commission, and Sink already counts our clicks, so our UTMs are NOT added (decision 2026-11-25). A query string
//      on such a destination is refused: it could overwrite or break Odoo's attribution.
//   2. a Nord Security affiliate link, exactly https://go.nordpass.io/aff_c?... or https://go.nordvpn.net/aff_c?... with the
//      offer_id and aff_id parameters, used VERBATIM: no utm_* parameter and no fragment (decision 2026-11-25: affiliate
//      links are never modified; Nord's own platform, affiliates.nordvpn.com, does the tracking).
//   3. a Namecheap affiliate link (FastVPN, impact.com), exactly https://namecheap.pxf.io/c/<digits>/<digits>/<digits> with NO
//      query string and no fragment, used VERBATIM (decision 2026-11-26: same rule as Nord; impact.com does the tracking).
//   4. anything else: https, with utm_source=<the file's utm_source>, utm_medium=referral and a utm_campaign.
// Slug rules and the "plain redirect only" field rule apply to both.
import { pathToFileURL } from 'node:url'

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const ALLOWED = new Set(['slug', 'url'])
const ODOO_AFFILIATE_PATH = /^\/r\/[A-Za-z0-9]+$/

/** @param {URL} u */
export const isOdooAffiliateRedirect = (u) =>
  u.protocol === 'https:' && u.hostname === 'www.odoo.com' && ODOO_AFFILIATE_PATH.test(u.pathname)

const NORD_HOSTS = new Set(['go.nordpass.io', 'go.nordvpn.net'])
/** @param {URL} u */
export const isNordAffiliateLink = (u) =>
  u.protocol === 'https:' && NORD_HOSTS.has(u.hostname) && u.pathname === '/aff_c' && !u.hash &&
  u.searchParams.has('offer_id') && u.searchParams.has('aff_id') && ![...u.searchParams.keys()].some((k) => k.startsWith('utm_'))

const NAMECHEAP_HOST = 'namecheap.pxf.io'
const NAMECHEAP_PATH = /^\/c\/\d+\/\d+\/\d+$/
/** @param {URL} u */
export const isNamecheapAffiliateLink = (u) =>
  u.protocol === 'https:' && u.hostname === NAMECHEAP_HOST && NAMECHEAP_PATH.test(u.pathname) && !u.search && !u.hash

/** @param {{slug:string,url:string}} l @param {string} utmSource */
export function linkProblems(l, utmSource) {
  const out = []
  for (const k of Object.keys(l)) if (!ALLOWED.has(k)) out.push(`${l.slug}: field "${k}" is not allowed`)
  if (!SLUG.test(l.slug)) out.push(`${l.slug}: slug must be lowercase-hyphen`)
  let u
  try { u = new URL(l.url) } catch { return [...out, `${l.slug}: url is not a URL`] }
  if (u.protocol !== 'https:') out.push(`${l.slug}: url must be https`)
  if (isOdooAffiliateRedirect(u)) {
    if (u.search || u.hash) out.push(`${l.slug}: an odoo.com/r/<code> destination must be plain, with no query string or fragment (Odoo's own tracking pays the commission)`)
  } else if (NORD_HOSTS.has(u.hostname)) {
    if (!isNordAffiliateLink(u)) out.push(`${l.slug}: a Nord destination must be https://<go.nordpass.io|go.nordvpn.net>/aff_c with offer_id and aff_id, verbatim: no utm_* parameter, no fragment`)
  } else if (u.hostname === NAMECHEAP_HOST) {
    if (!isNamecheapAffiliateLink(u)) out.push(`${l.slug}: a Namecheap destination must be https://namecheap.pxf.io/c/<id>/<id>/<id>, verbatim: no query string, no fragment`)
  } else {
    if (u.searchParams.get('utm_source') !== utmSource) out.push(`${l.slug}: utm_source must be ${utmSource}`)
    if (u.searchParams.get('utm_medium') !== 'referral') out.push(`${l.slug}: utm_medium must be referral`)
    if (!u.searchParams.get('utm_campaign')) out.push(`${l.slug}: utm_campaign is required`)
  }
  return out
}

export function selfTest() {
  const U = 'solvetuscom'
  const utm = '?utm_source=solvetuscom&utm_medium=referral&utm_campaign=odoo-apps'
  const cases = [
    ['a plain page with our three UTMs passes', { slug: 'odoo-website', url: `https://www.odoo.com/app/website${utm}` }, 0],
    ['an odoo.com/r/<code> destination with no UTMs passes (the one exception)', { slug: 'odoo-crm', url: 'https://www.odoo.com/r/TWcC' }, 0],
    ['an odoo.com/r/<code> with a code containing digits passes', { slug: 'odoo-events', url: 'https://www.odoo.com/r/0HKJ' }, 0],
    ['an odoo.com/r/<code> with our UTMs appended is refused', { slug: 'odoo-crm', url: `https://www.odoo.com/r/TWcC${utm}` }, 1],
    ['an odoo.com/r/<code> with any query string is refused', { slug: 'odoo-crm', url: 'https://www.odoo.com/r/TWcC?x=1' }, 1],
    ['an odoo.com/r/<code> with a fragment is refused', { slug: 'odoo-crm', url: 'https://www.odoo.com/r/TWcC#a' }, 1],
    ['an odoo.com page that is not /r/<code> still needs the UTMs', { slug: 'odoo-website', url: 'https://www.odoo.com/app/website' }, 1],
    ['odoo.com/r/ with no code still needs the UTMs', { slug: 'odoo-crm', url: 'https://www.odoo.com/r/' }, 1],
    ['odoo.com/r/<code>/more still needs the UTMs', { slug: 'odoo-crm', url: 'https://www.odoo.com/r/TWcC/more' }, 1],
    ['an /r/<code> path on another host still needs the UTMs', { slug: 'nordpass', url: 'https://nordpass.com/r/abc' }, 1],
    ['an /r/<code> on a look-alike host still needs the UTMs', { slug: 'odoo-crm', url: 'https://www.odoo.com.evil.example/r/TWcC' }, 1],
    ['an http odoo.com/r/<code> is refused', { slug: 'odoo-crm', url: 'http://www.odoo.com/r/TWcC' }, 1],
    ['a missing utm_source is caught', { slug: 'nordpass', url: 'https://nordpass.com/?utm_medium=referral&utm_campaign=x' }, 1],
    ['a wrong utm_medium is caught', { slug: 'nordpass', url: 'https://nordpass.com/?utm_source=solvetuscom&utm_medium=social&utm_campaign=x' }, 1],
    ['a missing utm_campaign is caught', { slug: 'nordpass', url: 'https://nordpass.com/?utm_source=solvetuscom&utm_medium=referral' }, 1],
    ['the real NordPass affiliate link passes, verbatim', { slug: 'nordpass', url: 'https://go.nordpass.io/aff_c?offer_id=488&aff_id=161943&url_id=9356' }, 0],
    ['the real NordVPN affiliate link passes, verbatim', { slug: 'nordvpn', url: 'https://go.nordvpn.net/aff_c?offer_id=15&aff_id=161943&url_id=902' }, 0],
    ['a Nord affiliate link with our UTMs appended is refused', { slug: 'nordpass', url: `https://go.nordpass.io/aff_c?offer_id=488&aff_id=161943&url_id=9356&utm_source=solvetuscom&utm_medium=referral&utm_campaign=x` }, 1],
    ['a Nord affiliate link with a fragment is refused', { slug: 'nordpass', url: 'https://go.nordpass.io/aff_c?offer_id=488&aff_id=161943&url_id=9356#a' }, 1],
    ['a Nord affiliate link on a look-alike host is refused', { slug: 'nordpass', url: 'https://go.nordpass.io.evil.example/aff_c?offer_id=488&aff_id=161943' }, 1],
    ['an http Nord affiliate link is refused', { slug: 'nordpass', url: 'https://go.nordpass.io/aff_c?offer_id=488&aff_id=161943&url_id=9356'.replace('https','http') }, 1],
    ['a Nord host with another path is refused', { slug: 'nordpass', url: 'https://go.nordpass.io/other?offer_id=488&aff_id=161943' }, 1],
    ['a Nord affiliate link without aff_id is refused', { slug: 'nordpass', url: 'https://go.nordpass.io/aff_c?offer_id=488&url_id=9356' }, 1],
    ['the real FastVPN (Namecheap) affiliate link passes, verbatim', { slug: 'fastvpn', url: 'https://namecheap.pxf.io/c/3284549/1159281/5618' }, 0],
    ['a Namecheap link with our UTMs appended is refused', { slug: 'fastvpn', url: 'https://namecheap.pxf.io/c/3284549/1159281/5618?utm_source=solvetuscom&utm_medium=referral&utm_campaign=x' }, 1],
    ['a Namecheap link with any query string is refused', { slug: 'fastvpn', url: 'https://namecheap.pxf.io/c/3284549/1159281/5618?subId1=x' }, 1],
    ['a Namecheap link with a fragment is refused', { slug: 'fastvpn', url: 'https://namecheap.pxf.io/c/3284549/1159281/5618#a' }, 1],
    ['a Namecheap link on another path is refused', { slug: 'fastvpn', url: 'https://namecheap.pxf.io/x/3284549/1159281/5618' }, 1],
    ['a Namecheap link with a non-numeric id is refused', { slug: 'fastvpn', url: 'https://namecheap.pxf.io/c/abc/1159281/5618' }, 1],
    ['a Namecheap path on a look-alike host still needs the UTMs', { slug: 'fastvpn', url: 'https://namecheap.pxf.io.evil.example/c/3284549/1159281/5618' }, 1],
    ['an http Namecheap link is refused', { slug: 'fastvpn', url: 'http://namecheap.pxf.io/c/3284549/1159281/5618' }, 1],
    ['a non-URL is caught', { slug: 'nordpass', url: 'not a url' }, 1],
    ['an upper-case slug is caught', { slug: 'Odoo-CRM', url: 'https://www.odoo.com/r/TWcC' }, 1],
    ['an extra field (password, geo, ...) is caught', { slug: 'odoo-crm', url: 'https://www.odoo.com/r/TWcC', password: 'x' }, 1],
  ]
  let bad = 0
  for (const [name, entry, min] of cases) {
    const n = linkProblems(entry, U).length
    if (min === 0 ? n !== 0 : n < 1) { bad++; console.error(`SELF-TEST FAIL: ${name} (${n} problems)`) }
  }
  if (bad) { console.error(`link-rules self-test: ${bad} case(s) wrong`); process.exit(1) }
  console.log(`link-rules self-test: ${cases.length} cases ok`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-test')) selfTest()
  else { console.error('usage: link-rules.mjs --self-test'); process.exit(2) }
}
