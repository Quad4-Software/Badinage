// Jingle session state machine: owns the sid, role and ordering rules
// from XEP-0166 and turns inbound packets into caller-facing results.
// Stanza building delegates to stanzas.ts. The caller sends through
// the transport and owns the WebRTC side of the call.

import type { StanzaBuilder } from '../features/transport'
import { jingleIq, type UniqueIdSource } from './stanzas'
import type { JingleCandidate, JingleContent, JinglePacket, JingleReason } from './types'

export type SessionRole = 'initiator' | 'responder'
export type SessionState = 'pending' | 'active' | 'ended'

export type ApplyResult =
  | { kind: 'offer'; contents: JingleContent[] }
  | { kind: 'answer'; contents: JingleContent[] }
  | { kind: 'terminated'; reason: string }
  | { kind: 'ringing' }
  | { kind: 'candidates'; byContent: Map<string, JingleCandidate[]> }
  | { kind: 'ignored'; why: string }
  | { kind: 'invalid'; why: string }

export class JingleSession {
  state: SessionState = 'pending'

  constructor(
    readonly sid: string,
    readonly peer: string,
    readonly role: SessionRole,
    private readonly localJid: string
  ) {}

  // responder side: a session-initiate packet becomes a session when
  // its initiator attribute matches the sender. Anything else is not
  // ours to answer
  static fromInitiate(packet: JinglePacket, localJid: string): JingleSession | null {
    if (packet.action !== 'session-initiate') return null
    if (packet.initiator && packet.initiator !== packet.from) return null
    return new JingleSession(packet.sid, packet.from, 'responder', localJid)
  }

  private stanza(
    conn: UniqueIdSource,
    action: JinglePacket['action'],
    extra?: { contents?: JingleContent[]; reason?: string; info?: string }
  ): StanzaBuilder {
    return jingleIq(conn, this.peer, {
      action,
      sid: this.sid,
      initiator: this.role === 'initiator' ? this.localJid : this.peer,
      responder: this.role === 'responder' ? this.localJid : this.peer,
      contents: extra?.contents ?? [],
      reason: extra?.reason,
      info: extra?.info
    })
  }

  initiateStanza(conn: UniqueIdSource, contents: JingleContent[]): StanzaBuilder {
    return this.stanza(conn, 'session-initiate', { contents })
  }

  acceptStanza(conn: UniqueIdSource, contents: JingleContent[]): StanzaBuilder {
    return this.stanza(conn, 'session-accept', { contents })
  }

  terminateStanza(conn: UniqueIdSource, reason: JingleReason): StanzaBuilder {
    this.state = 'ended'
    return this.stanza(conn, 'session-terminate', { reason })
  }

  infoStanza(conn: UniqueIdSource, info: string): StanzaBuilder {
    return this.stanza(conn, 'session-info', { info })
  }

  transportInfoStanza(conn: UniqueIdSource, contents: JingleContent[]): StanzaBuilder {
    return this.stanza(conn, 'transport-info', { contents })
  }

  // routes an inbound packet through the role and state checks and
  // returns what the call layer should do with it
  apply(packet: JinglePacket): ApplyResult {
    if (packet.from !== this.peer) return { kind: 'ignored', why: 'other peer' }
    if (packet.sid !== this.sid) return { kind: 'ignored', why: 'other session' }
    if (this.state === 'ended') return { kind: 'ignored', why: 'session ended' }

    switch (packet.action) {
      case 'session-initiate': {
        if (this.role !== 'responder' || this.state !== 'pending') {
          return { kind: 'invalid', why: 'unexpected initiate' }
        }
        return { kind: 'offer', contents: packet.contents }
      }
      case 'session-accept': {
        if (this.role !== 'initiator' || this.state !== 'pending') {
          return { kind: 'invalid', why: 'unexpected accept' }
        }
        this.state = 'active'
        return { kind: 'answer', contents: packet.contents }
      }
      case 'session-terminate': {
        this.state = 'ended'
        return { kind: 'terminated', reason: packet.reason ?? 'success' }
      }
      case 'session-info': {
        if (packet.info === 'ringing') return { kind: 'ringing' }
        return { kind: 'ignored', why: `session-info ${packet.info ?? ''}` }
      }
      case 'transport-info': {
        const byContent = new Map<string, JingleCandidate[]>()
        for (const content of packet.contents) {
          if (content.transport.candidates.length > 0) {
            byContent.set(content.name, content.transport.candidates)
          }
        }
        return { kind: 'candidates', byContent }
      }
      default:
        return { kind: 'ignored', why: `unsupported action ${packet.action}` }
    }
  }
}
