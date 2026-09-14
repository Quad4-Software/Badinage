import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CallMediaDeps } from '$lib/core/call/engine'
import type { Account } from '../accounts.svelte'
import type { ChatConnection } from '$lib/core/xmpp/types'
import type { JinglePacket } from '$lib/core/xmpp/jingle/types'
import { calls } from './call.svelte'

// no webrtc in node: fake the capability check and the media deps the
// store pulls through browserMediaDeps
const sent: string[] = []
let iqOk = true

const h = vi.hoisted(() => ({
  mediaGate: undefined as Promise<unknown> | undefined,
  pcCloses: 0
}))

vi.mock('$lib/core/call/browser', () => {
  const pc = {
    onicecandidate: null,
    ontrack: null,
    oniceconnectionstatechange: null,
    iceConnectionState: 'new',
    addTrack: () => undefined,
    createOffer: async () => ({ type: 'offer', sdp: 'offer-sdp' }),
    createAnswer: async () => ({ type: 'answer', sdp: 'answer-sdp' }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
    addIceCandidate: async () => undefined,
    close: () => {
      h.pcCloses += 1
    }
  }
  const deps: CallMediaDeps = {
    peer: () => pc as unknown as RTCPeerConnection,
    media: async () => {
      await h.mediaGate
      return {
        getTracks: () => [],
        getAudioTracks: () => [],
        getVideoTracks: () => []
      } as unknown as MediaStream
    }
  }
  return {
    callsSupported: () => true,
    browserMediaDeps: () => deps
  }
})

function fakeAccount(out: string[] = sent): Account {
  const conn = {
    jid: 'me@x.test/web',
    uniqueId: (p: string) => `${p}-seq`,
    sendJingle: (stanza: { toString(): string }, onDone?: (ok: boolean) => void) => {
      out.push(stanza.toString())
      onDone?.(iqOk)
    },
    jingleSupported: (_jid: string, onDone: (ok: boolean) => void) => onDone(true),
    externalServices: (onDone: (services: never[]) => void) => onDone([])
  }
  return { jid: 'me@x.test', connection: conn as unknown as ChatConnection } as Account
}

function initiatePacket(sid = 's-peer'): JinglePacket {
  return {
    action: 'session-initiate',
    sid,
    from: 'peer@x.test/phone',
    initiator: 'peer@x.test/phone',
    contents: [
      {
        name: '0',
        media: 'audio',
        creator: 'initiator',
        senders: 'both',
        payloads: [{ id: '111', name: 'opus', clockrate: '48000' }],
        transport: { ufrag: 'u', pwd: 'p', candidates: [] }
      }
    ]
  }
}

// engine offer/answer chains resolve on microtasks after start/accept
// return. waitFor flushes them without fake timers
async function lastStanza(): Promise<string> {
  await vi.waitFor(() => {
    expect(sent.length).toBeGreaterThan(0)
  })
  return sent[sent.length - 1] ?? ''
}

beforeEach(() => {
  calls.reset()
  calls.capable.clear()
  sent.length = 0
  iqOk = true
  h.mediaGate = undefined
  h.pcCloses = 0
})

describe('CallStore gating', () => {
  it('exposes calls only when the transport offers sendJingle', () => {
    expect(calls.canCall(fakeAccount())).toBe(true)
    const irc = {
      jid: 'nick@irc',
      connection: { jid: 'nick!u@h', uniqueId: (p: string) => p }
    }
    expect(calls.canCall(irc as unknown as Account)).toBe(false)
  })

  it('caches peer support probes', () => {
    const account = fakeAccount()
    const probe = vi.fn((_j: string, onDone: (ok: boolean) => void) => onDone(true))
    ;(account.connection as unknown as { jingleSupported: typeof probe }).jingleSupported = probe
    calls.probe(account, 'peer@x.test/phone')
    calls.probe(account, 'peer@x.test/phone')
    expect(probe).toHaveBeenCalledTimes(1)
    expect(calls.capable.get('peer@x.test/phone')).toBe(true)
  })
})

describe('outgoing calls', () => {
  it('sends a session-initiate and tracks the dialing phase', async () => {
    const account = fakeAccount()
    await calls.start(account, 'peer@x.test/phone', false)
    expect(calls.view?.phase).toBe('dialing')
    const stanza = await lastStanza()
    expect(stanza).toContain('session-initiate')
    expect(stanza).toContain('urn:xmpp:jingle:1')
  })

  it('refuses to start without a full jid', async () => {
    await calls.start(fakeAccount(), 'peer@x.test', false)
    expect(calls.view).toBeNull()
    expect(sent).toHaveLength(0)
  })

  it('cleans up when the peer rejects the initiate iq', async () => {
    iqOk = false
    await calls.start(fakeAccount(), 'peer@x.test/phone', false)
    await vi.waitFor(() => {
      expect(calls.view?.phase).toBe('ended')
    })
    expect(calls.view?.endReason).toBe('failed-application')
  })

  it('moves to connecting when the accept arrives', async () => {
    const account = fakeAccount()
    await calls.start(account, 'peer@x.test/phone', false)
    const stanza = await lastStanza()
    const sid = stanza.match(/sid="([^"]+)"/)?.[1] ?? ''
    calls.notePacket(account, {
      action: 'session-accept',
      sid,
      from: 'peer@x.test/phone',
      contents: [
        {
          name: '0',
          media: 'audio',
          creator: 'responder',
          senders: 'both',
          payloads: [{ id: '111', name: 'opus', clockrate: '48000' }],
          transport: { ufrag: 'v', pwd: 'w', candidates: [] }
        }
      ]
    })
    expect(calls.view?.phase).toBe('connecting')
  })
})

describe('incoming calls', () => {
  it('shows an incoming view and accepts with session-accept', async () => {
    const account = fakeAccount()
    calls.notePacket(account, initiatePacket())
    expect(calls.view?.phase).toBe('incoming')
    expect(calls.view?.peer).toBe('peer@x.test/phone')
    await calls.accept()
    const stanza = await lastStanza()
    expect(stanza).toContain('session-accept')
  })

  it('detects video calls from the offered contents', () => {
    const account = fakeAccount()
    const packet = initiatePacket()
    if (packet.contents[0]) packet.contents[0].media = 'video'
    calls.notePacket(account, packet)
    expect(calls.view?.video).toBe(true)
  })

  it('sends decline on reject and ends the view', () => {
    const account = fakeAccount()
    calls.notePacket(account, initiatePacket())
    calls.decline()
    expect(sent[0]).toContain('session-terminate')
    expect(sent[0]).toContain('decline')
    expect(calls.view?.phase).toBe('ended')
  })

  it('ends when the peer terminates', () => {
    const account = fakeAccount()
    calls.notePacket(account, initiatePacket())
    calls.notePacket(account, {
      action: 'session-terminate',
      sid: 's-peer',
      from: 'peer@x.test/phone',
      contents: [],
      reason: 'cancel'
    })
    expect(calls.view?.phase).toBe('ended')
  })
})

describe('ghost sessions', () => {
  it('answers a second initiate with busy while a call is live', () => {
    const account = fakeAccount()
    calls.notePacket(account, initiatePacket('s1'))
    calls.notePacket(account, initiatePacket('s2'))
    expect(sent[0]).toContain('session-terminate')
    expect(sent[0]).toContain('busy')
    expect(calls.view?.phase).toBe('incoming')
  })

  it('answers stray packets with unknown-session', () => {
    const account = fakeAccount()
    calls.notePacket(account, {
      action: 'transport-info',
      sid: 'ghost',
      from: 'peer@x.test/phone',
      contents: []
    })
    expect(sent[0]).toContain('session-terminate')
    expect(sent[0]).toContain('unknown-session')
  })

  it('keeps the live call on its own account after a busy ghost', () => {
    const outA: string[] = []
    const outB: string[] = []
    const a = fakeAccount(outA)
    const b = fakeAccount(outB)
    calls.notePacket(a, initiatePacket('s1'))
    calls.notePacket(b, initiatePacket('s2'))
    calls.decline()
    expect(outB).toHaveLength(1)
    expect(outB[0]).toContain('busy')
    expect(outA[0]).toContain('session-terminate')
    expect(outA[0]).toContain('decline')
  })

  it('hangup during a pending media request sends no initiate', async () => {
    let release!: () => void
    h.mediaGate = new Promise<void>((resolve) => (release = resolve))
    const account = fakeAccount()
    const started = calls.start(account, 'peer@x.test/phone', false)
    calls.hangup()
    release()
    await started
    // the orphaned engine must close the pc setup creates after the
    // gate releases, and no initiate stanza may leave
    await vi.waitFor(() => {
      expect(h.pcCloses).toBe(1)
    })
    expect(sent).toHaveLength(0)
  })
})
