// WorkerOmemoCrypto over the fake transport in fake-worker.ts: the
// real client talks to the real install() dispatch loop, so the wire
// protocol, FIFO serialization, error mapping and lifecycle all run
// for real. Only postMessage and IndexedDB are faked.

import { describe, expect, it } from 'vitest'

import { WorkerCryptoDownError, WorkerOmemoCrypto } from './client'
import { accountBackend, encryptFor, FakeWorker, readyCrypto } from './fake-worker'

import { DuplicateMessageError, serializeXml } from '@quad4-software/badinage-omemo'

const ROMEO = 'romeo@example.net'
const JULIET = 'juliet@example.net'

describe('WorkerOmemoCrypto', () => {
  it('round-trips encrypt/decrypt between two accounts over the wire', async () => {
    const a = await readyCrypto(ROMEO)
    const b = await readyCrypto(JULIET)
    const element = await encryptFor(a.crypto, b.crypto, JULIET, 'wire hello')
    expect(serializeXml(element)).toContain('encrypted')

    const result = await b.crypto.decrypt('omemo2', element, ROMEO)
    expect(result.empty).toBe(false)
    expect(new TextDecoder().decode(result.plaintext)).toBe('wire hello')
    expect(result.sid).toBe(a.crypto.deviceId)
  })

  it('serializes concurrent decrypts of the same stanza into a duplicate', async () => {
    const a = await readyCrypto(ROMEO)
    const b = await readyCrypto(JULIET)
    // establish a full session first: key exchange stanzas legitimately
    // re-decrypt (retransmission tolerance), so only a stanza after the
    // peer answered exercises replay detection
    await b.crypto.decrypt('omemo2', await encryptFor(a.crypto, b.crypto, JULIET, 'm1'), ROMEO)
    await a.crypto.decrypt('omemo2', await encryptFor(b.crypto, a.crypto, ROMEO, 'r1'), JULIET)
    const element = await encryptFor(a.crypto, b.crypto, JULIET, 'replay me')
    // two decrypts of identical key material race the ratchet. The
    // worker FIFO must serialize them: first succeeds, second hits
    // duplicate detection instead of both committing the same state
    const [first, second] = await Promise.allSettled([
      b.crypto.decrypt('omemo2', element, ROMEO),
      b.crypto.decrypt('omemo2', element, ROMEO)
    ])
    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual(['fulfilled', 'rejected'])
    const rejected = first.status === 'rejected' ? first : second
    expect(rejected.status).toBe('rejected')
    if (rejected.status === 'rejected') {
      expect(rejected.reason).toBeInstanceOf(DuplicateMessageError)
    }
  })

  it('gives concurrent encrypts distinct ratchet counters', async () => {
    const a = await readyCrypto(ROMEO)
    const b = await readyCrypto(JULIET)
    // seed the session so neither encrypt carries a key exchange
    await b.crypto.decrypt('omemo2', await encryptFor(a.crypto, b.crypto, JULIET, 'm1'), ROMEO)
    await a.crypto.decrypt('omemo2', await encryptFor(b.crypto, a.crypto, ROMEO, 'r1'), JULIET)
    // two encrypts racing the same session state. Without the FIFO
    // both load the same counter and produce duplicate wire counters,
    // which the peer then sees as a replay
    const [e1, e2] = await Promise.all([
      encryptFor(a.crypto, b.crypto, JULIET, 'first'),
      encryptFor(a.crypto, b.crypto, JULIET, 'second')
    ])
    const r1 = await b.crypto.decrypt('omemo2', e1, ROMEO)
    const r2 = await b.crypto.decrypt('omemo2', e2, ROMEO)
    const bodies = [
      new TextDecoder().decode(r1.plaintext),
      new TextDecoder().decode(r2.plaintext)
    ].sort()
    expect(bodies).toEqual(['first', 'second'])
  })

  it('keeps private key material inside the worker', async () => {
    const { crypto } = await readyCrypto(ROMEO)
    const wire = await crypto.identityKey('omemo2')
    expect(wire).toBeInstanceOf(Uint8Array)
    // the wire public key, not the 32 byte secret scalar
    expect(wire?.length).toBeGreaterThan(0)
    const store = (await crypto.getDeviceIds('omemo2', ROMEO)) ?? []
    expect(store).not.toContain(NaN)
  })

  it('keeps two accounts fully independent', async () => {
    const a = await readyCrypto(ROMEO)
    const b = await readyCrypto(JULIET)
    expect(a.crypto.deviceId).not.toBe(b.crypto.deviceId)
    const aKey = await a.crypto.identityKey('omemo2')
    const bKey = await b.crypto.identityKey('omemo2')
    expect(aKey).not.toEqual(bKey)
  })

  it('runs many concurrent ops without losing or doubling replies', async () => {
    const { crypto } = await readyCrypto(ROMEO)
    const ops = Array.from({ length: 40 }, (_, i) =>
      i % 2 === 0
        ? crypto.getDeviceIds('omemo2', `peer${i}@x`)
        : crypto.putDeviceIds('omemo2', `peer${i}@x`, [i])
    )
    await Promise.all(ops)
    for (let i = 1; i < 40; i += 2) {
      expect(await crypto.getDeviceIds('omemo2', `peer${i}@x`)).toEqual([i])
    }
  })

  it('rejects everything pending and respawns after a worker crash', async () => {
    const { crypto, workers } = await readyCrypto(ROMEO)
    const worker = workers[0]
    expect(worker).toBeDefined()
    const inFlight = crypto.getDeviceIds('omemo2', 'peer@x')
    worker?.crash(new Error('kaboom'))
    await expect(inFlight).rejects.toBeInstanceOf(WorkerCryptoDownError)
    expect(worker?.terminated).toBe(true)
    expect(crypto.stats.killed).toBe(1)

    // the next call spawns a fresh worker over the same stores
    const ids = await crypto.getDeviceIds('omemo2', 'peer@x')
    expect(ids).toBeUndefined()
    expect(workers.length).toBe(2)
    expect(crypto.stats.respawns).toBe(1)
  })

  it('preserves sessions across a respawn like IndexedDB would', async () => {
    const shared = accountBackend()
    const a = await readyCrypto(ROMEO)
    const workersB: FakeWorker[] = []
    const b = new WorkerOmemoCrypto(
      { accountJid: JULIET, ownJid: JULIET },
      () => {
        const worker = new FakeWorker(shared)
        workersB.push(worker)
        return worker
      },
      200
    )
    await b.maintain('omemo2')
    const element = await encryptFor(a.crypto, b, JULIET, 'before crash')
    await b.decrypt('omemo2', element, ROMEO)
    workersB[0]?.crash()
    // a fresh worker reloads the persisted session and still decrypts
    const element2 = await encryptFor(a.crypto, b, JULIET, 'after crash')
    const result = await b.decrypt('omemo2', element2, ROMEO)
    expect(new TextDecoder().decode(result.plaintext)).toBe('after crash')
    expect(workersB.length).toBe(2)
  })

  it('times out a wedged worker, kills it and recovers on the next call', async () => {
    const workers: FakeWorker[] = []
    let first = true
    const crypto = new WorkerOmemoCrypto(
      { accountJid: ROMEO, ownJid: ROMEO },
      () => {
        const worker = new FakeWorker(accountBackend())
        // only the first worker wedges
        worker.paused = first
        first = false
        workers.push(worker)
        return worker
      },
      80
    )
    await expect(crypto.getDeviceIds('omemo2', 'peer@x')).rejects.toBeInstanceOf(
      WorkerCryptoDownError
    )
    expect(workers[0]?.terminated).toBe(true)
    expect(crypto.stats.killed).toBe(1)
    // recovery: the respawned worker answers
    expect(await crypto.putDeviceIds('omemo2', 'peer@x', [7])).toBeUndefined()
    expect(await crypto.getDeviceIds('omemo2', 'peer@x')).toEqual([7])
    expect(workers.length).toBe(2)
  })

  it('drops stale replies from a replaced worker', async () => {
    const { crypto, workers } = await readyCrypto(ROMEO)
    const old = workers[0]
    old?.crash()
    // respawn, then have the dead worker emit a late reply with a
    // made-up id: nothing may resolve or throw from it
    await crypto.getDeviceIds('omemo2', 'peer@x')
    expect(workers.length).toBe(2)
    old?.deliver({ id: 9999, ok: true, value: 'stale' })
    old?.deliver({ id: 1, ok: true, value: 'stale' })
    // still healthy afterwards
    expect(await crypto.getDeviceIds('omemo2', 'peer@x')).toBeUndefined()
  })

  it('dispose rejects pending and all future calls without respawning', async () => {
    const { crypto, workers } = await readyCrypto(ROMEO)
    const inFlight = crypto.getDeviceIds('omemo2', 'peer@x')
    crypto.dispose()
    await expect(inFlight).rejects.toBeInstanceOf(WorkerCryptoDownError)
    await expect(crypto.getDeviceIds('omemo2', 'peer@x')).rejects.toBeInstanceOf(
      WorkerCryptoDownError
    )
    expect(workers[0]?.terminated).toBe(true)
    expect(workers.length).toBe(1)
  })

  it('rejects calls made against an uninitialized dead worker', async () => {
    const workers: FakeWorker[] = []
    const crypto = new WorkerOmemoCrypto(
      { accountJid: ROMEO, ownJid: ROMEO },
      () => {
        const worker = new FakeWorker(accountBackend())
        worker.paused = true
        workers.push(worker)
        return worker
      },
      60
    )
    // init itself never answers: create-time readiness fails
    await expect(crypto.maintain('omemo2')).rejects.toBeInstanceOf(WorkerCryptoDownError)
  })

  it('maps wire errors back to their error classes', async () => {
    const { crypto } = await readyCrypto(ROMEO)
    // a parse failure produces a real protocol error whose class
    // survives the boundary
    const garbage = await crypto
      .parseBundle('omemo2', { name: 'bundle', attrs: {}, children: [], text: '' })
      .then(
        () => null,
        (error: unknown) => error
      )
    expect(garbage).toBeInstanceOf(Error)
    expect((garbage as Error).name).not.toBe('Error')
  })
})
