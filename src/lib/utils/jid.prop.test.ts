import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { bareJid, isValidBareJid, isValidUserJid, jidDomain, jidResource, parseJid } from './jid'

const jidish = fc.string({
  unit: fc.constantFrom('a', 'b', 'c', '.', '@', '/', '-', '_', '0', ' '),
  maxLength: 16
})
const part = fc.string({
  unit: fc.constantFrom('a', 'b', 'c', 'x', 'y', '0', '1', '-', '.', '_'),
  minLength: 1,
  maxLength: 8
})
const noAtNoSlash = fc.string({
  unit: fc.constantFrom('a', 'b', '.', '-', '_', '0', ' '),
  maxLength: 12
})
const edge = fc.constantFrom('', '/', '@', 'a@', '@b', 'a/b/c', 'a@@b', 'a/')
const structured = fc
  .record({ local: part, domain: part, resource: fc.option(part) })
  .map(({ local, domain, resource }) =>
    resource === null ? `${local}@${domain}` : `${local}@${domain}/${resource}`
  )
const anyJid = fc.oneof(jidish, structured, fc.domain(), edge, fc.string({ maxLength: 32 }))

describe('property: parseJid', () => {
  it('never throws and always yields a string domain', () => {
    fc.assert(
      fc.property(anyJid, (jid) => {
        const parsed = parseJid(jid)
        expect(typeof parsed.domain).toBe('string')
      })
    )
  })

  it('splits bare and resource on the first slash', () => {
    fc.assert(
      fc.property(anyJid, (jid) => {
        const slash = jid.indexOf('/')
        const expectedBare = slash === -1 ? jid : jid.slice(0, slash)
        const tail = slash === -1 ? '' : jid.slice(slash + 1)
        const parsed = parseJid(jid)
        expect(bareJid(jid)).toBe(expectedBare)
        expect(bareJid(jid).includes('/')).toBe(false)
        // an empty resource is reported as absent
        expect(parsed.resource).toBe(tail || undefined)
        expect(jidResource(jid)).toBe(tail || undefined)
      })
    )
  })

  it('local is the part before the last @ of the bare jid', () => {
    fc.assert(
      fc.property(anyJid, (jid) => {
        const bare = bareJid(jid)
        const at = bare.lastIndexOf('@')
        const parsed = parseJid(jid)
        if (at === -1) {
          expect(parsed.local).toBeUndefined()
          expect(parsed.domain).toBe(bare)
        } else {
          expect(parsed.local).toBe(bare.slice(0, at))
          expect(parsed.domain).toBe(bare.slice(at + 1))
        }
        expect(jidDomain(jid)).toBe(parsed.domain)
      })
    )
  })

  it('round-trips structured local@domain/resource jids', () => {
    fc.assert(
      fc.property(
        fc.record({ local: part, domain: part, resource: part }),
        ({ local, domain, resource }) => {
          const jid = `${local}@${domain}/${resource}`
          expect(parseJid(jid)).toEqual({ local, domain, resource })
          expect(bareJid(jid)).toBe(`${local}@${domain}`)
          expect(jidDomain(jid)).toBe(domain)
          expect(jidResource(jid)).toBe(resource)
          expect(isValidUserJid(jid)).toBe(true)
          expect(isValidBareJid(jid)).toBe(true)
        }
      )
    )
  })

  it('parses adversarial edge inputs deterministically', () => {
    expect(parseJid('')).toEqual({ domain: '' })
    expect(parseJid('/')).toEqual({ domain: '' })
    expect(parseJid('@')).toEqual({ local: '', domain: '' })
    expect(parseJid('a@')).toEqual({ local: 'a', domain: '' })
    expect(parseJid('@b')).toEqual({ local: '', domain: 'b' })
    expect(parseJid('a/b/c')).toEqual({ domain: 'a', resource: 'b/c' })
    expect(parseJid('a@@b')).toEqual({ local: 'a@', domain: 'b' })
    expect(parseJid('a/')).toEqual({ domain: 'a' })
  })
})

describe('property: validity predicates', () => {
  it('isValidUserJid implies non-empty local and domain and a valid bare jid', () => {
    fc.assert(
      fc.property(anyJid, (jid) => {
        if (!isValidUserJid(jid)) return
        const parsed = parseJid(jid)
        expect(parsed.local?.length).toBeGreaterThan(0)
        expect(parsed.domain.length).toBeGreaterThan(0)
        expect(isValidBareJid(jid)).toBe(true)
      })
    )
  })

  it('isValidBareJid requires a non-empty domain', () => {
    fc.assert(
      fc.property(anyJid, (jid) => {
        if (isValidBareJid(jid)) expect(jidDomain(jid).length).toBeGreaterThan(0)
      })
    )
  })

  it('isValidBareJid accepts domain-only jids but isValidUserJid does not', () => {
    fc.assert(
      fc.property(fc.domain(), (domain) => {
        expect(parseJid(domain)).toEqual({ domain })
        expect(isValidBareJid(domain)).toBe(true)
        expect(isValidUserJid(domain)).toBe(false)
      })
    )
  })

  it('isValidBareJid is exactly non-empty for strings without @ or /', () => {
    fc.assert(
      fc.property(noAtNoSlash, (jid) => {
        expect(isValidBareJid(jid)).toBe(jid.length > 0)
      })
    )
  })
})
