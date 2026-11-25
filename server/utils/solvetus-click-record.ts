// Solvetus fork: the ONE code divergence from upstream (see SOLVETUS.md).
// A click record keeps only what counting clicks needs. This is an allowlist:
// any field upstream adds later is dropped by default.
import type { AccessLogResult, LogsMap } from './access-log'

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/

// Hostname only: lowercase, no port, no path. An IP literal is not a "referring website".
export function refererDomain(host: string | undefined): string {
  const h = (host || '').trim().toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  if (!h || IPV4.test(h) || h.includes(':'))
    return ''
  return h
}

export function minimiseAccessLog({ logs, click }: AccessLogResult): AccessLogResult {
  const kept: LogsMap = {
    slug: logs.slug,
    url: logs.url,
    referer: refererDomain(logs.referer),
    country: logs.country,
    os: logs.os,
    browser: logs.browser,
    browserType: logs.browserType,
    deviceType: logs.deviceType,
    // dropped, neutral values keep the record shape the dashboard queries expect
    ua: '',
    ip: '',
    region: '',
    city: '',
    timezone: '',
    language: '',
    device: '',
    COLO: '',
    latitude: 0,
    longitude: 0,
  }
  return {
    logs: kept,
    click: { ...click, region: '', city: '', referer: refererDomain(click.referer) },
  }
}
