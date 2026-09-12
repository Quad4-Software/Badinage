// Demo mode: a fake XmppConnection that emits believable traffic so the app
// can be tried without a server. Activated by logging in with the JID
// demo@badinage.local (any password) or the Try the demo button.

import { Emitter } from '$lib/core/events'

import type {
  AttachmentMeta,
  ConnectionStatus,
  MamPageResult,
  SendMessageOptions,
  SubscriptionRequest,
  UploadSlot
} from './connection'
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

type DmHistoryEntry = {
  who: 'them' | 'me'
  body: string
  agoMin: number
  stanzaId: string
  replyTo?: IncomingMessage['replyTo']
  replaceId?: IncomingMessage['replaceId']
  attachments?: IncomingMessage['attachments']
  signed?: boolean
}

// A one second 8-bit mono PCM sine blip, built at module load so the demo
// voice message has playable audio without shipping a binary asset.
function demoVoiceDataUri(): string {
  const rate = 8000
  const n = rate
  const bytes = new Uint8Array(44 + n)
  const v = new DataView(bytes.buffer)
  const tag = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i))
  }
  tag(0, 'RIFF')
  v.setUint32(4, 36 + n, true)
  tag(8, 'WAVE')
  tag(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate, true)
  v.setUint16(32, 1, true)
  v.setUint16(34, 8, true)
  tag(36, 'data')
  v.setUint32(40, n, true)
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, (n - i) / 2000)
    bytes[44 + i] = 128 + Math.round(80 * fade * Math.sin((i / rate) * 440 * 2 * Math.PI))
  }
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return `data:audio/wav;base64,${btoa(bin)}`
}

const VOICE_WAV = demoVoiceDataUri()

const DM_HISTORY: Record<string, DmHistoryEntry[]> = {
  'aria@badinage.local': [
    { who: 'them', body: 'did the deploy land?', agoMin: 190, stanzaId: 'd-hist-aria-1' },
    {
      who: 'me',
      body: 'yes, about an hour ago. watching metrics now',
      agoMin: 185,
      stanzaId: 'd-hist-aria-2'
    },
    {
      who: 'them',
      body: 'error rate looks flat. ship it',
      agoMin: 120,
      stanzaId: 'd-hist-aria-3'
    },
    {
      who: 'me',
      body: 'badinage release notes drafted too',
      agoMin: 118,
      stanzaId: 'd-hist-aria-4'
    },
    { who: 'them', body: 'nice. review tomorrow?', agoMin: 14, stanzaId: 'd-hist-aria-5' },
    // aria corrects her previous message
    {
      who: 'them',
      body: 'review at 10?',
      agoMin: 13,
      stanzaId: 'd-hist-aria-6',
      replaceId: 'd-hist-aria-5'
    },
    {
      who: 'them',
      body: 'quick voice note',
      agoMin: 12,
      stanzaId: 'd-hist-aria-7',
      attachments: [{ url: VOICE_WAV, mediaType: 'audio/ogg', name: 'voice.ogg', duration: 7 }]
    }
  ],
  'cleo@badinage.local': [
    {
      who: 'them',
      body: 'the MUC history sync works!',
      agoMin: 60,
      stanzaId: 'd-hist-cleo-1',
      signed: true
    },
    {
      who: 'me',
      body: 'told you the scrollback would land',
      agoMin: 58,
      stanzaId: 'd-hist-cleo-2'
    },
    // cleo replies to her own earlier message
    {
      who: 'them',
      body: 'it really does, finally',
      agoMin: 57,
      stanzaId: 'd-hist-cleo-3',
      replyTo: {
        id: 'd-hist-cleo-1',
        from: 'cleo@badinage.local',
        quote: 'the MUC history sync works!'
      }
    },
    { who: 'them', body: 'screenshots look great too', agoMin: 5, stanzaId: 'd-hist-cleo-4' },
    {
      who: 'them',
      body: 'the logo export',
      agoMin: 4,
      stanzaId: 'd-hist-cleo-5',
      attachments: [
        { url: '/icons/icon-192.png', mediaType: 'image/png', name: 'logo.png', size: 7264 }
      ]
    }
  ],
  'dmitri@badinage.local': [
    { who: 'me', body: 'can you check the nginx conf?', agoMin: 400, stanzaId: 'd-hist-dmitri-1' },
    { who: 'them', body: 'after standup', agoMin: 390, stanzaId: 'd-hist-dmitri-2' }
  ]
}

const ROOM_HISTORY: {
  nick: string
  body: string
  agoMin: number
  stanzaId: string
  attachments?: IncomingMessage['attachments']
}[] = [
  { nick: 'cleo', body: 'morning all', agoMin: 95, stanzaId: 'room-1' },
  {
    nick: 'dmitri',
    body: 'morning. anyone seen the prosody logs?',
    agoMin: 90,
    stanzaId: 'room-2'
  },
  {
    nick: 'aria',
    body: 'rotate at midnight filled the disk again',
    agoMin: 88,
    stanzaId: 'room-3'
  },
  { nick: 'wren', body: 'I put a fix in the dev compose file', agoMin: 40, stanzaId: 'room-4' },
  { nick: 'cleo', body: 'merged, thanks', agoMin: 35, stanzaId: 'room-5' },
  {
    nick: 'aria',
    body: 'rough mockup for the profile pane',
    agoMin: 20,
    stanzaId: 'room-6',
    attachments: [
      { url: '/icons/icon-192.png', mediaType: 'image/png', name: 'mockup.png', size: 7264 }
    ]
  },
  { nick: 'wren', body: 'badinage demo mode looks cute btw', agoMin: 6, stanzaId: 'room-7' }
]

// One extra page of older history per peer so scroll-up paging is visible
// in demo mode. Timestamps sit about a day back so they always land in
// front of the seeded history and produce a day separator.
const DM_PAGE: { who: 'them' | 'me'; body: string; agoMin: number }[] = [
  {
    who: 'them',
    body: 'did you see the outage notice from earlier?',
    agoMin: 1600
  },
  {
    who: 'me',
    body: 'yeah, looked like a cert renewal hiccup',
    agoMin: 1590
  },
  { who: 'them', body: 'that explains the reconnects', agoMin: 1580 }
]

const ROOM_PAGE: { nick: string; body: string; agoMin: number }[] = [
  { nick: 'wren', body: 'is the new build server up yet?', agoMin: 1620 },
  { nick: 'cleo', body: 'just provisioned it this morning', agoMin: 1610 },
  { nick: 'dmitri', body: 'finally, the old one was crawling', agoMin: 1590 }
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
  // peers that already got their one older history page
  private mamPaged = new Set<string>()

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

  sendChatMessage(
    to: string,
    body: string,
    type: 'chat' | 'groupchat' = 'chat',
    opts?: SendMessageOptions
  ): string {
    const id = this.uniqueId('msg')
    this.timers.push(setTimeout(() => this.simulateReply(to, type), 1200 + Math.random() * 2400))
    void body
    void opts
    return id
  }

  sendReaction(
    to: string,
    targetId: string,
    emojis: string[],
    type: 'chat' | 'groupchat' = 'chat'
  ): void {
    // echo the reaction back from a peer so the demo shows a live update
    const isRoom = type === 'groupchat' || to === ROOM || to.includes('@conference.')
    this.timers.push(
      setTimeout(() => {
        this.events.emit('message', {
          from: isRoom ? `${ROOM}/aria` : to,
          to: this.jid,
          body: '',
          type: isRoom ? 'groupchat' : 'chat',
          nick: isRoom ? 'aria' : undefined,
          stanzaId: this.uniqueId('react'),
          reactionTo: { id: targetId, emojis }
        })
      }, 800)
    )
  }

  sendAttachment(
    to: string,
    url: string,
    type: 'chat' | 'groupchat' = 'chat',
    meta?: AttachmentMeta
  ): string {
    // pretend the file went out and let the peer respond as usual
    const id = this.uniqueId('att')
    this.timers.push(setTimeout(() => this.simulateReply(to, type), 1200 + Math.random() * 2400))
    void url
    void meta
    return id
  }

  discoverUploadService(onDone: (serviceJid: string | null) => void): void {
    // pretend a service exists; slot requests still fall back to data uris
    onDone('upload.badinage.local')
  }

  requestUploadSlot(
    name: string,
    size: number,
    mediaType: string,
    onDone: (slot: UploadSlot | null) => void
  ): void {
    // never grant a slot so the ui exercises its data uri fallback
    void name
    void size
    void mediaType
    onDone(null)
  }

  uploadFile(
    putUrl: string,
    file: Blob,
    headers?: Record<string, string>,
    onProgress?: (fraction: number) => void
  ): Promise<void> {
    // nothing is really uploaded; report completion anyway
    void putUrl
    void file
    void headers
    onProgress?.(1)
    return Promise.resolve()
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
  fetchAvatar(jid: string, onDone: (dataUri: string | undefined) => void): void {
    // the lobby room gets the app mark as its avatar
    onDone(jid === ROOM ? '/icons/icon-192.png' : undefined)
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

  queryArchive(
    peerJid: string,
    opts: { max?: number; before?: string | undefined; room?: boolean | undefined },
    onDone: (result: MamPageResult) => void
  ): void {
    void opts.max
    // calls without a before cursor are the initial pull; the seeded
    // history stands in for it, so hand back a cursor that lets scroll-up
    // fetch one more page
    if (opts.before === undefined) {
      onDone(
        this.mamPaged.has(peerJid)
          ? { complete: true }
          : { complete: false, first: `mam-page-${peerJid}-0` }
      )
      return
    }
    if (this.mamPaged.has(peerJid)) {
      onDone({ complete: true })
      return
    }
    this.mamPaged.add(peerJid)
    this.timers.push(
      setTimeout(() => {
        const isRoom = opts.room === true || peerJid.includes('@conference.')
        if (isRoom) {
          for (const [i, entry] of ROOM_PAGE.entries()) {
            this.events.emit('message', {
              from: `${peerJid}/${entry.nick}`,
              to: this.jid,
              body: entry.body,
              type: 'groupchat',
              nick: entry.nick,
              stanzaId: `mam-page-${peerJid}-${i + 1}`,
              mam: true,
              delay: ago(entry.agoMin)
            })
          }
        } else {
          for (const [i, entry] of DM_PAGE.entries()) {
            this.events.emit('message', {
              from: entry.who === 'me' ? this.jid : peerJid,
              to: entry.who === 'me' ? peerJid : this.jid,
              body: entry.body,
              type: 'chat',
              stanzaId: `mam-page-${peerJid}-${i + 1}`,
              mam: true,
              delay: ago(entry.agoMin),
              carbon: entry.who === 'me' ? 'sent' : undefined
            })
          }
        }
        onDone({ complete: true, first: `mam-page-${peerJid}-1` })
      }, 400)
    )
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
          stanzaId: m.stanzaId,
          delay: ago(m.agoMin),
          carbon: m.who === 'me' ? 'sent' : undefined,
          replyTo: m.replyTo,
          replaceId: m.replaceId,
          attachments: m.attachments,
          signed: m.signed
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
        stanzaId: m.stanzaId,
        delay: ago(m.agoMin),
        attachments: m.attachments
      })
    }
    // cleo reacts to wren's last room message
    this.events.emit('message', {
      from: `${ROOM}/cleo`,
      to: this.jid,
      body: '',
      type: 'groupchat',
      nick: 'cleo',
      stanzaId: 'room-8',
      delay: ago(5),
      reactionTo: { id: 'room-7', emojis: ['❤️'] }
    })
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
    // aria reacts to our release notes message a few seconds in
    this.timers.push(
      setTimeout(() => {
        this.events.emit('message', {
          from: 'aria@badinage.local',
          to: this.jid,
          body: '',
          type: 'chat',
          stanzaId: this.uniqueId('live'),
          reactionTo: { id: 'd-hist-aria-4', emojis: ['🎉'] }
        })
      }, 5000)
    )
    // a second live dm from a different contact shortly after esme's
    this.timers.push(
      setTimeout(() => {
        this.events.emit('message', {
          from: 'benedikt@badinage.local',
          to: this.jid,
          body: 'back from lunch, the deploy looks clean',
          type: 'chat',
          stanzaId: this.uniqueId('live')
        })
      }, 5500)
    )
  }

  private simulateReply(to: string, type: 'chat' | 'groupchat' = 'chat'): void {
    const isRoom = type === 'groupchat' || to === ROOM || to.includes('@conference.')
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
