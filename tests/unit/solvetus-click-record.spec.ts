import type { H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { blobsMap, collectAccessLog, doublesMap, logs2blobs, logs2doubles } from '../../server/utils/access-log'
import { minimiseAccessLog } from '../../server/utils/solvetus-click-record'

// Solvetus fork self-test: a click record must never carry an IP, coordinates or a raw User-Agent.

vi.mock('#shared/utils/flag', () => ({ getFlag: () => '🏳️' }))

const UAS = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}

const IPS = ['203.0.113.77', '2001:db8:85a3::8a2e:370:7334']
const IPV4_RE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/
const IPV6_RE = /(?:[0-9a-f]{1,4}:){2}[0-9a-f:]*/i

const cf = {
  country: 'PT',
  region: 'Faro',
  city: 'Portimao',
  timezone: 'Europe/Lisbon',
  colo: 'LIS',
  latitude: '37.13',
  longitude: '-8.53',
}

function fakeEvent(headers: Record<string, string>, ip: string): H3Event {
  vi.stubGlobal('getHeader', (_e: unknown, name: string) => headers[name.toLowerCase()])
  vi.stubGlobal('getRequestIP', () => ip)
  vi.stubGlobal('useRuntimeConfig', () => ({ disableBotAccessLog: false }))
  return {
    context: {
      cloudflare: { request: { cf } },
      link: { id: 'link_1', slug: 'nordpass', url: 'https://go.nordpass.io/aff_c?offer_id=1' },
    },
  } as unknown as H3Event
}

function recordFor(ua: string, ip: string, referer: string) {
  const event = fakeEvent({
    'cf-connecting-ip': ip,
    'x-real-ip': ip,
    'user-agent': ua,
    'referer': referer,
    'accept-language': 'pt-PT,pt;q=0.9',
    'cf-iplatitude': '37.13',
    'cf-iplongitude': '-8.53',
  }, ip)
  const result = collectAccessLog(event)!
  return {
    result,
    blobs: logs2blobs(result.logs),
    doubles: logs2doubles(result.logs),
  }
}

function assertMinimised(blobs: string[], doubles: number[], ua: string, ip: string) {
  const all = blobs.join('\n')
  expect(all).not.toContain(ip)
  expect(all).not.toMatch(IPV4_RE)
  expect(all).not.toMatch(IPV6_RE)
  expect(all).not.toContain('Mozilla/')
  for (let i = 0; i + 20 <= ua.length; i += 5)
    expect(all).not.toContain(ua.slice(i, i + 20))
  for (const v of [cf.region, cf.city, cf.timezone, cf.colo, 'pt-PT', 'Faro', 'Portimao'])
    expect(all).not.toContain(v)
  expect(doubles.every(d => d === 0)).toBe(true)
}

describe('solvetus click record minimisation', () => {
  beforeEach(() => vi.unstubAllGlobals())

  for (const [name, ua] of Object.entries(UAS)) {
    for (const ip of IPS) {
      it(`${name} / ${ip}: no IP, coordinates, UA or place in the written record`, () => {
        const { blobs, doubles } = recordFor(ua, ip, 'https://Blog.Example.com:8443/post?q=1#x')
        assertMinimised(blobs, doubles, ua, ip)
      })
    }
  }

  it('keeps slug, country, coarse device/browser/OS and the referring domain only', () => {
    const { result } = recordFor(UAS.iphone, IPS[0]!, 'https://Blog.Example.com:8443/post?q=1')
    expect(result.logs).toMatchObject({
      slug: 'nordpass',
      country: 'PT',
      referer: 'blog.example.com',
      os: 'iOS',
      browser: 'Mobile Safari',
      deviceType: 'mobile',
    })
    expect(result.click).toMatchObject({ country: 'PT', region: '', city: '', referer: 'blog.example.com' })
  })

  it('blanks a referer that is an IP literal', () => {
    for (const r of ['http://203.0.113.9/p', 'http://[2001:db8::1]:8080/p']) {
      const { blobs } = recordFor(UAS.chrome, IPS[0]!, r)
      expect(blobs.join('\n')).not.toMatch(IPV4_RE)
      expect(blobs[Object.values(blobsMap).indexOf('referer')]).toBe('')
    }
  })

  it('allowlist: a record with every field filled keeps only the allowed ones', () => {
    const logs = Object.fromEntries([
      ...Object.values(blobsMap).map(k => [k, `SENTINEL-${k}`]),
      ...Object.values(doublesMap).map(k => [k, 42]),
    ])
    const out = minimiseAccessLog({ logs, click: { country: 'PT', region: 'R', city: 'C', device: 'd', browser: 'b', os: 'o', referer: 'x.com' } } as never)
    const kept = Object.entries(out.logs).filter(([, v]) => v !== '' && v !== 0).map(([k]) => k).sort()
    expect(kept).toEqual(['browser', 'browserType', 'country', 'deviceType', 'os', 'referer', 'slug', 'url'])
    expect(out.logs.referer).toBe('sentinel-referer')
    expect(out.click.region).toBe('')
    expect(out.click.city).toBe('')
  })
})
