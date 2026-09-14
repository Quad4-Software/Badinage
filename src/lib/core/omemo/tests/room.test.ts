// Group OMEMO (XEP-0384 in MUC): one encrypted stanza whose header keys
// cover every member's devices, sent to the room as groupchat. Sessions
// stay keyed on the members' real jids.

import { describe, expect, it } from 'vitest'

import { NAMESPACES } from '@quad4-software/badinage-omemo'

import { makeAccount, stanza, type PepDir } from './fixture'

const ROMEO = 'romeo@example.net'
const JULIET = 'juliet@example.net'
const MERCUTIO = 'mercutio@example.net'
const ROOM = 'chat@conference.example.net'

describe('encryptRoomBody', () => {
  it('produces one stanza every member device can decrypt', async () => {
    const pep: PepDir = new Map()
    const a = await makeAccount(`${ROMEO}/desk`, pep)
    const b = await makeAccount(`${JULIET}/phone`, pep)
    const c = await makeAccount(`${MERCUTIO}/w`, pep)
    await Promise.all([a.service.publishOwn(), b.service.publishOwn(), c.service.publishOwn()])

    const xml = await a.service.encryptRoomBody(ROOM, [JULIET, MERCUTIO], 'room hi')
    expect(xml).not.toBeNull()
    expect(xml).toContain(`xmlns='${NAMESPACES.omemo2.element}'`)

    // the groupchat stanza arrives from the room nick. Decryption
    // resolves the sender's real jid through the caller
    const forJuliet = stanza(`${ROOM}/romeo`, JULIET, xml ?? '')
    forJuliet.type = 'groupchat'
    const r1 = await b.service.decryptInto(forJuliet, ROMEO)
    expect(r1.status).toBe('decrypted')
    expect(forJuliet.body).toBe('room hi')

    const forMercutio = stanza(`${ROOM}/romeo`, MERCUTIO, xml ?? '')
    forMercutio.type = 'groupchat'
    const r2 = await c.service.decryptInto(forMercutio, ROMEO)
    expect(r2.status).toBe('decrypted')
    expect(forMercutio.body).toBe('room hi')
  })

  it('keeps envelope content inside the room stanza', async () => {
    const pep: PepDir = new Map()
    const a = await makeAccount(`${ROMEO}/desk`, pep)
    const b = await makeAccount(`${JULIET}/phone`, pep)
    await a.service.publishOwn()
    await b.service.publishOwn()

    const xml = await a.service.encryptRoomBody(ROOM, [JULIET], 'edited', {
      replaceId: 'orig-7',
      spoilerHint: 'careful'
    })
    const message = stanza(`${ROOM}/romeo`, JULIET, xml ?? '')
    await b.service.decryptInto(message, ROMEO)
    expect(message.replaceId).toBe('orig-7')
    expect(message.spoilerHint).toBe('careful')
  })

  it('returns null when any member publishes no usable devices', async () => {
    const pep: PepDir = new Map()
    const a = await makeAccount(`${ROMEO}/desk`, pep)
    const b = await makeAccount(`${JULIET}/phone`, pep)
    await a.service.publishOwn()
    await b.service.publishOwn()

    // a member without devices could never read the stanza: encrypting
    // anyway would silently exclude them, so the caller gets null and
    // sends plaintext to the room
    expect(await a.service.encryptRoomBody(ROOM, [JULIET, 'ghost@example.net'], 'hi')).toBeNull()
  })

  it('records trust under the real jid only when senderJid resolves', async () => {
    const pep: PepDir = new Map()
    const a = await makeAccount(`${ROMEO}/desk`, pep)
    const b = await makeAccount(`${JULIET}/phone`, pep)
    await a.service.publishOwn()
    await b.service.publishOwn()

    const xml = await a.service.encryptRoomBody(ROOM, [JULIET], 'identity check')
    // kex payloads self-establish a session, so decryption succeeds
    // either way. Without the real jid the fingerprint and device
    // bookkeeping land on the room address, which corrupts the trust
    // list and sends key transports to the room
    const wrong = stanza(`${ROOM}/romeo`, JULIET, xml ?? '')
    await b.service.decryptInto(wrong)
    expect(b.service.trust.get(ROOM, a.service.deviceId)).toBeDefined()
    expect(b.service.trust.get(ROMEO, a.service.deviceId)).toBeUndefined()

    const right = stanza(`${ROOM}/romeo`, JULIET, xml ?? '')
    const report = await b.service.decryptInto(right, ROMEO)
    expect(report.status).toBe('decrypted')
    expect(b.service.trust.get(ROMEO, a.service.deviceId)).toBeDefined()
  })
})
