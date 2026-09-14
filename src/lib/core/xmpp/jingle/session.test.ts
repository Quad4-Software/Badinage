import { describe, expect, it } from 'vitest'

import { servicesToIceServers } from './extdisco'
import { JingleSession } from './session'
import type { JinglePacket } from './types'

function packet(partial: Partial<JinglePacket>): JinglePacket {
  return {
    action: 'session-info',
    sid: 's1',
    from: 'peer@x.test/phone',
    contents: [],
    ...partial
  }
}

describe('JingleSession', () => {
  const initiate = packet({
    action: 'session-initiate',
    initiator: 'peer@x.test/phone',
    contents: []
  })

  it('accepts a matching session-initiate and rejects spoofed initiators', () => {
    const session = JingleSession.fromInitiate(initiate, 'me@x.test/web')
    expect(session?.role).toBe('responder')
    expect(session?.peer).toBe('peer@x.test/phone')
    const spoofed = packet({
      action: 'session-initiate',
      initiator: 'other@x.test/y'
    })
    expect(JingleSession.fromInitiate(spoofed, 'me@x.test/web')).toBeNull()
  })

  it('moves pending to active on session-accept for the initiator', () => {
    const session = new JingleSession('s1', 'peer@x.test/phone', 'initiator', 'me@x.test/web')
    const result = session.apply(packet({ action: 'session-accept' }))
    expect(result.kind).toBe('answer')
    expect(session.state).toBe('active')
  })

  it('rejects a session-accept on the responder side', () => {
    const session = new JingleSession('s1', 'peer@x.test/phone', 'responder', 'me@x.test/web')
    expect(session.apply(packet({ action: 'session-accept' })).kind).toBe('invalid')
  })

  it('collects transport-info candidates per content name', () => {
    const session = new JingleSession('s1', 'peer@x.test/phone', 'initiator', 'me@x.test/web')
    session.apply(packet({ action: 'session-accept' }))
    const result = session.apply(
      packet({
        action: 'transport-info',
        contents: [
          {
            name: '0',
            creator: 'responder',
            senders: 'both',
            payloads: [],
            transport: {
              candidates: [
                {
                  foundation: '1',
                  component: '1',
                  protocol: 'udp',
                  priority: '1',
                  ip: '1.2.3.4',
                  port: '5',
                  type: 'host',
                  generation: '0',
                  network: '0'
                }
              ]
            }
          }
        ]
      })
    )
    expect(result.kind).toBe('candidates')
    if (result.kind === 'candidates') {
      expect(result.byContent.get('0')?.[0]?.ip).toBe('1.2.3.4')
    }
  })

  it('ends on session-terminate and ignores everything after', () => {
    const session = new JingleSession('s1', 'peer@x.test/phone', 'initiator', 'me@x.test/web')
    const result = session.apply(packet({ action: 'session-terminate', reason: 'decline' }))
    expect(result).toEqual({ kind: 'terminated', reason: 'decline' })
    expect(session.apply(packet({ action: 'session-info' })).kind).toBe('ignored')
  })

  it('ignores packets from other sids and other peers', () => {
    const session = new JingleSession('s1', 'peer@x.test/phone', 'initiator', 'me@x.test/web')
    expect(session.apply(packet({ sid: 'other' })).kind).toBe('ignored')
    expect(session.apply(packet({ from: 'else@x.test/z' })).kind).toBe('ignored')
  })
})

describe('servicesToIceServers', () => {
  it('maps stun and credentialed turn services', () => {
    const servers = servicesToIceServers([
      { type: 'stun', host: 'stun.x.test', port: '3478' },
      {
        type: 'turn',
        host: 'turn.x.test',
        port: '5349',
        transport: 'udp',
        username: 'u',
        password: 'p'
      }
    ])
    expect(servers[0]).toEqual({ urls: 'stun:stun.x.test:3478' })
    expect(servers[1]).toEqual({
      urls: 'turn:turn.x.test:5349?transport=udp',
      username: 'u',
      credential: 'p'
    })
  })

  it('skips unknown service types', () => {
    expect(servicesToIceServers([{ type: 'ftp', host: 'x' }])).toEqual([])
  })
})
