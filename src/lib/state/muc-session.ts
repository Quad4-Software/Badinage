// Room session watchdog, one per account: XEP-0199 self-pings while
// joined so ghost occupants get noticed, and bounded auto-rejoin after
// a kick (status 307) or a stream drop. Bans (301) and join errors
// never auto-retry; the conversation flags and the ui banner carry the
// user-facing side.

import { MUC_SELF_PING_MS, ROOM_REJOIN_DELAY_MS, ROOM_REJOIN_MAX_ATTEMPTS } from '$lib/constants'
import type { ChatConnection, ConnectionStatus } from '$lib/core/xmpp/connection'
import { SELF_BANNED_CODE, SELF_KICKED_CODE, SELF_RENAMED_CODE } from '$lib/core/xmpp/features/muc'
import type { MucOccupant, PresenceError } from '$lib/core/xmpp/stanzas'
import { bareJid } from '$lib/utils/jid'

import type { ChatStore } from './chats.svelte'

interface RoomSession {
  attempts: number
  ping?: ReturnType<typeof setInterval> | undefined
  rejoin?: ReturnType<typeof setTimeout> | undefined
}

export class RoomSessions {
  private sessions = new Map<string, RoomSession>()

  constructor(
    private readonly connection: ChatConnection,
    private readonly store: ChatStore
  ) {}

  // Feed every occupant event through here before the store applies it.
  // Self-presence decides ping lifetime and rejoin scheduling.
  noteOccupant(occupant: MucOccupant): void {
    const conversation = this.store.open(occupant.room, 'muc')
    const self =
      occupant.self || (occupant.presence === 'offline' && occupant.nick === conversation.ourNick)
    if (!self) return

    if (occupant.presence !== 'offline') {
      // a (re)join or the online half of a rename landed
      const session = this.session(occupant.room)
      session.attempts = 0
      if (session.rejoin) {
        clearTimeout(session.rejoin)
        session.rejoin = undefined
      }
      this.startPing(occupant.room)
      return
    }

    this.stopPing(occupant.room)
    // the unavailable half of a nick change is not a departure
    if (occupant.codes.includes(SELF_RENAMED_CODE)) return
    if (occupant.codes.includes(SELF_BANNED_CODE)) {
      // banned: never auto-rejoin, the banner explains instead
      this.cancelRejoin(occupant.room)
      return
    }
    if (occupant.codes.includes(SELF_KICKED_CODE)) {
      this.scheduleRejoin(occupant.room)
    }
    // a plain self-unavailable is a manual leave or room shutdown and
    // never auto-rejoins
  }

  noteStatus(status: ConnectionStatus): void {
    if (status === 'connected') this.rejoinAll()
    if (status === 'disconnected') this.pauseAll()
  }

  // Presence type=error from a room we know about. Sets the banner
  // state and stops automatic retries so a 409 never retry-loops.
  noteJoinError(error: PresenceError): void {
    const room = bareJid(error.from)
    const conversation = this.store.conversations.get(room)
    if (!conversation || conversation.kind !== 'muc') return
    conversation.joinError = {
      code: error.code,
      condition: error.condition,
      text: error.text
    }
    conversation.joined = false
    this.cancelRejoin(room)
    this.stopPing(room)
    // some servers send the condition without the legacy numeric code
    if (error.code === '403' || error.condition === 'forbidden') {
      conversation.banned = true
    }
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      if (session.ping) clearInterval(session.ping)
      if (session.rejoin) clearTimeout(session.rejoin)
    }
    this.sessions.clear()
  }

  private session(room: string): RoomSession {
    let session = this.sessions.get(room)
    if (!session) {
      session = { attempts: 0 }
      this.sessions.set(room, session)
    }
    return session
  }

  // On (re)connect every still-joined room gets a fresh join; the MAM
  // cursor stays where it was because store.mamDone is session scoped.
  private rejoinAll(): void {
    for (const conversation of this.store.conversations.values()) {
      if (conversation.kind !== 'muc' || !conversation.joined || !conversation.ourNick) continue
      this.session(conversation.peerJid).attempts = 0
      this.connection.joinRoom(conversation.peerJid, conversation.ourNick, conversation.password)
      this.startPing(conversation.peerJid)
    }
  }

  private pauseAll(): void {
    for (const session of this.sessions.values()) {
      if (session.ping) clearInterval(session.ping)
      if (session.rejoin) clearTimeout(session.rejoin)
      session.ping = undefined
      session.rejoin = undefined
    }
    // the roster is stale while offline; clear it so no ghost occupants
    // render, but keep joined set so reconnect rejoins
    for (const conversation of this.store.conversations.values()) {
      if (conversation.kind === 'muc') {
        conversation.occupants.clear()
        conversation.typers.clear()
      }
    }
  }

  private startPing(room: string): void {
    const session = this.session(room)
    if (session.ping) return
    session.ping = setInterval(() => {
      const conversation = this.store.conversations.get(room)
      const nick = conversation?.ourNick
      if (!conversation?.joined || !nick || !this.connection.connected) {
        this.stopPing(room)
        return
      }
      this.connection.pingOccupant(room, nick, (alive) => {
        if (!alive) this.scheduleRejoin(room)
      })
    }, MUC_SELF_PING_MS)
  }

  private stopPing(room: string): void {
    const session = this.sessions.get(room)
    if (session?.ping) {
      clearInterval(session.ping)
      session.ping = undefined
    }
  }

  private scheduleRejoin(room: string): void {
    const conversation = this.store.conversations.get(room)
    const nick = conversation?.ourNick
    if (!conversation || !nick || conversation.banned) return
    const session = this.session(room)
    if (session.rejoin || session.attempts >= ROOM_REJOIN_MAX_ATTEMPTS) return
    const delay = ROOM_REJOIN_DELAY_MS * 2 ** session.attempts
    session.attempts++
    session.rejoin = setTimeout(() => {
      session.rejoin = undefined
      const current = this.store.conversations.get(room)
      if (!current?.ourNick || current.banned) return
      this.connection.joinRoom(room, current.ourNick, current.password)
    }, delay)
  }

  private cancelRejoin(room: string): void {
    const session = this.sessions.get(room)
    if (session?.rejoin) {
      clearTimeout(session.rejoin)
      session.rejoin = undefined
    }
  }
}
