// Demo mode: a fake XmppConnection that emits believable traffic so the app
// can be tried without a server. Activated by logging in with the JID
// demo@badinage.local (any password) or the Try the demo button.

import { Emitter } from '$lib/core/events'

import type { ConnectionStatus, SubscriptionRequest } from './connection'
import type {
  ChatState,
  IncomingMessage,
  MarkerType,
  MucOccupant,
  PresenceUpdate,
  RosterItem
} from './stanzas'

type DemoEvents = {
  status: ConnectionStatus
  message: IncomingMessage
  presence: PresenceUpdate
  roster: RosterItem[]
  rosterUpdate: RosterItem
  rosterRemove: string
  subscriptionRequest: SubscriptionRequest
  occupant: MucOccupant
}

const ROOM = 'lobby@conference.badinage.local'

const CONTACTS: { jid: string; name: string; presence: string; status: string }[] = [
  { jid: 'aria@badinage.local', name: 'Aria', presence: 'online', status: 'around' },
  { jid: 'benedikt@badinage.local', name: 'Benedikt', presence: 'away', status: 'lunch' },
  { jid: 'cleo@badinage.local', name: 'Cleo', presence: 'online', status: '' },
  { jid: 'dmitri@badinage.local', name: 'Dmitri', presence: 'dnd', status: 'heads down' },
  { jid: 'esme@badinage.local', name: 'Esmé', presence: 'xa', status: 'offline-ish' }
]

const ROOM_OCCUPANTS = [
  { nick: 'aria', affiliation: 'member', role: 'participant' },
  { nick: 'cleo', affiliation: 'admin', role: 'moderator' },
  { nick: 'dmitri', affiliation: 'member', role: 'participant' },
  { nick: 'wren', affiliation: 'none', role: 'visitor' }
]

const DM_HISTORY: Record<string, { who: 'them' | 'me'; body: string; agoMin: number }[]> = {
  'aria@badinage.local': [
    { who: 'them', body: 'did the deploy land?', agoMin: 190 },
    { who: 'me', body: 'yes, about an hour ago. watching metrics now', agoMin: 185 },
    { who: 'them', body: 'error rate looks flat. ship it', agoMin: 120 },
    { who: 'me', body: 'badinage release notes drafted too', agoMin: 118 },
    { who: 'them', body: 'nice. review tomorrow?', agoMin: 14 }
  ],
  'cleo@badinage.local': [
    { who: 'them', body: 'the MUC history sync works!', agoMin: 60 },
    { who: 'me', body: 'told you the scrollback would land', agoMin: 58 },
    { who: 'them', body: 'screenshots look great too', agoMin: 5 }
  ],
  'dmitri@badinage.local': [
    { who: 'me', body: 'can you check the nginx conf?', agoMin: 400 },
    { who: 'them', body: 'after standup', agoMin: 390 }
  ]
}

const ROOM_HISTORY: { nick: string; body: string; agoMin: number }[] = [
  { nick: 'cleo', body: 'morning all', agoMin: 95 },
  { nick: 'dmitri', body: 'morning. anyone seen the prosody logs?', agoMin: 90 },
  { nick: 'aria', body: 'rotate at midnight filled the disk again', agoMin: 88 },
  { nick: 'wren', body: 'I put a fix in the dev compose file', agoMin: 40 },
  { nick: 'cleo', body: 'merged, thanks', agoMin: 35 },
  { nick: 'wren', body: 'badinage demo mode looks cute btw', agoMin: 6 }
]

const REPLIES = [
  'lol',
  'on it',
  'makes sense to me',
  'can you send a link?',
  'ack',
  'nice',
  'give me five minutes',
  '+1'
]

function ago(minutes: number): number {
  return Date.now() - minutes * 60_000
}

export class DemoConnection {
  readonly events = new Emitter<DemoEvents>()

  connected = false
  jid = ''
  private timers: ReturnType<typeof setTimeout>[] = []
  private replyTimer: ReturnType<typeof setTimeout> | null = null

  connect(jid: string, _password: string): void {
    this.jid = jid
    this.events.emit('status', 'connecting')
    this.timers.push(
      setTimeout(() => {
        this.connected = true
        this.events.emit('status', 'connected')
        this.seed()
      }, 400)
    )
  }

  disconnect(): void {
    for (const t of this.timers) clearTimeout(t)
    if (this.replyTimer) clearTimeout(this.replyTimer)
    this.connected = false
    this.events.emit('status', 'disconnected')
  }

  uniqueId(prefix: string): string {
    return `demo-${prefix}-${Math.random().toString(36).slice(2, 10)}`
  }

  sendChatMessage(to: string, body: string): string {
    const id = this.uniqueId('msg')
    this.timers.push(setTimeout(() => this.simulateReply(to), 1200 + Math.random() * 2400))
    void body
    return id
  }

  sendChatState(to: string, state: ChatState, type: 'chat' | 'groupchat' = 'chat'): void {
    if (state !== 'composing' || type !== 'chat') return
    // peer starts typing back a beat later
    this.timers.push(
      setTimeout(() => {
        this.events.emit('message', {
          from: to,
          to: this.jid,
          body: '',
          type: 'chat',
          chatState: 'composing'
        })
      }, 900)
    )
  }

  sendReceipt(to: string, id: string): void {
    void to
    void id
  }

  sendMarker(to: string, id: string, marker: MarkerType): void {
    void to
    void id
    void marker
  }

  sendPresence(): void {
    // demo presence is already seeded in connect()
  }
  sendDirectedPresence(to: string, type?: string): void {
    if (type === 'subscribe') {
      // demo contacts always accept after a beat
      this.timers.push(
        setTimeout(() => {
          this.events.emit('rosterUpdate', {
            jid: to,
            name: '',
            subscription: 'both',
            groups: []
          })
          this.events.emit('presence', { from: to, show: 'online', status: '' })
        }, 1500)
      )
    }
  }

  fetchRoster(): void {
    this.events.emit(
      'roster',
      CONTACTS.map((c) => ({
        jid: c.jid,
        name: c.name,
        subscription: 'both',
        groups: []
      }))
    )
  }

  rosterSet(jid: string, name: string): void {
    this.events.emit('rosterUpdate', { jid, name, subscription: 'none', groups: [] })
  }

  rosterRemove(jid: string): void {
    this.events.emit('rosterRemove', jid)
  }

  joinRoom(room: string, nick: string): void {
    const occupants: MucOccupant[] = [
      {
        room,
        nick,
        presence: 'online',
        affiliation: 'member',
        role: 'participant',
        self: true,
        codes: ['110']
      },
      ...ROOM_OCCUPANTS.map((o) => ({
        room,
        nick: o.nick,
        presence: 'online',
        affiliation: o.affiliation,
        role: o.role,
        self: false,
        codes: []
      }))
    ]
    for (const occupant of occupants) this.events.emit('occupant', occupant)
    this.events.emit('message', {
      from: room,
      to: this.jid,
      body: '',
      type: 'groupchat',
      subject: 'Badinage lobby: be nice'
    })
  }

  leaveRoom(room: string, nick: string): void {
    this.events.emit('occupant', {
      room,
      nick,
      presence: 'offline',
      affiliation: 'member',
      role: 'none',
      self: true,
      codes: ['110']
    })
  }

  setRoomSubject(room: string, subject: string): void {
    void room
    void subject
  }

  queryArchive(): void {
    // demo data is seeded eagerly, no archive to page
  }

  enableCarbons(): void {
    // demo mode emits carbon-shaped history directly
  }

  private seed(): void {
    this.fetchRoster()
    for (const contact of CONTACTS) {
      this.events.emit('presence', {
        from: contact.jid,
        show: contact.presence,
        status: contact.status
      })
    }
    for (const [peer, history] of Object.entries(DM_HISTORY)) {
      for (const m of history) {
        this.events.emit('message', {
          from: m.who === 'me' ? this.jid : peer,
          to: m.who === 'me' ? peer : this.jid,
          body: m.body,
          type: 'chat',
          stanzaId: this.uniqueId('hist'),
          delay: ago(m.agoMin),
          carbon: m.who === 'me' ? 'sent' : undefined
        })
      }
    }
    this.joinRoom(ROOM, 'you')
    for (const m of ROOM_HISTORY) {
      this.events.emit('message', {
        from: `${ROOM}/${m.nick}`,
        to: this.jid,
        body: m.body,
        type: 'groupchat',
        nick: m.nick,
        stanzaId: this.uniqueId('room'),
        delay: ago(m.agoMin)
      })
    }
    // a fresh unread + a pending subscription request for realism
    this.timers.push(
      setTimeout(() => {
        this.events.emit('message', {
          from: 'esme@badinage.local',
          to: this.jid,
          body: 'hey, is this the new client?',
          type: 'chat',
          stanzaId: this.uniqueId('live')
        })
      }, 2500)
    )
    this.timers.push(
      setTimeout(() => {
        this.events.emit('subscriptionRequest', {
          from: 'wren@badinage.local',
          status: 'would like to chat'
        })
      }, 4000)
    )
  }

  private simulateReply(to: string): void {
    const isRoom = to === ROOM || to.startsWith('conference.')
    const from = isRoom ? `${ROOM}/aria` : to
    this.events.emit('message', {
      from,
      to: this.jid,
      body: REPLIES[Math.floor(Math.random() * REPLIES.length)] ?? 'ack',
      type: isRoom ? 'groupchat' : 'chat',
      nick: isRoom ? 'aria' : undefined,
      stanzaId: this.uniqueId('reply')
    })
  }
}
