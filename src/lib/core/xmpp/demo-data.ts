// Fixture data and scripted traffic for demo mode: contacts, occupants,
// seeded history, the canned reply pool and the one extra archive page
// per peer. demo.ts keeps the fake transport itself. Everything here is
// data plus small emit helpers over it.

import type { Emitter } from '$lib/core/events'
import {
  InMemoryOmemoStore,
  NS_OMEMO2_BUNDLES,
  NS_OMEMO2_DEVICES,
  OmemoManager,
  serializeXml
} from '$lib/core/omemo'

import type { ConnectionEvents } from './connection'
import type { Bookmark, DataForm, IncomingMessage, MucOccupant, RosterItem } from './stanzas'

type DemoEmitter = Emitter<ConnectionEvents>

export const ROOM = 'lobby@conference.badinage.local'
export const ROOM_SUBJECT = 'Badinage lobby: be nice'
// the invite scheduled a few seconds in points at this room
const INVITE_ROOM = 'lounge@conference.badinage.local'
// base-aware icon url. A root-relative path 404s under a subpath deploy
const ICON_URL = `${import.meta.env.BASE_URL}icons/icon-192.png`

// delays for the scripted live traffic emitted by scheduleLiveEvents
const DEMO_LIVE_MESSAGE_DELAY_MS = 2500
const DEMO_SUBSCRIPTION_REQUEST_DELAY_MS = 4000
const DEMO_LIVE_REACTION_DELAY_MS = 5000
const DEMO_SECOND_LIVE_MESSAGE_DELAY_MS = 5500
const DEMO_ROOM_INVITE_DELAY_MS = 7000
const DEMO_LIVE_RETRACT_DELAY_MS = 9000

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
  spoilerHint?: string
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
    {
      who: 'them',
      body: 'latency graph is *finally* flat, see `_p99` in `grafana`',
      agoMin: 40,
      stanzaId: 'd-hist-aria-4b'
    },
    {
      who: 'them',
      body: '/me celebrates quietly',
      agoMin: 39,
      stanzaId: 'd-hist-aria-4c'
    },
    {
      who: 'them',
      body: 'the butler did it, obviously',
      agoMin: 30,
      stanzaId: 'd-hist-aria-4d',
      spoilerHint: 'book club ending'
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
      attachments: [{ url: ICON_URL, mediaType: 'image/png', name: 'logo.png', size: 7264 }]
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
  spoilerHint?: string
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
  {
    nick: 'dmitri',
    body: 'the failover runs on the *standby* node only',
    agoMin: 38,
    stanzaId: 'room-4b'
  },
  {
    nick: 'wren',
    body: '/me files the follow-up ticket',
    agoMin: 37,
    stanzaId: 'room-4c'
  },
  {
    nick: 'cleo',
    body: 'it was the dns ttl all along',
    agoMin: 36,
    stanzaId: 'room-4d',
    spoilerHint: ''
  },
  { nick: 'cleo', body: 'merged, thanks', agoMin: 35, stanzaId: 'room-5' },
  {
    nick: 'aria',
    body: 'rough mockup for the profile pane',
    agoMin: 20,
    stanzaId: 'room-6',
    attachments: [{ url: ICON_URL, mediaType: 'image/png', name: 'mockup.png', size: 7264 }]
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

function randomReply(): string {
  return REPLIES[Math.floor(Math.random() * REPLIES.length)] ?? 'ack'
}

// a target counts as a room when the message type says so or the jid
// points at the conference service
function isRoomTarget(to: string, type: 'chat' | 'groupchat'): boolean {
  return type === 'groupchat' || to === ROOM || to.includes('@conference.')
}

export function demoRosterItems(): RosterItem[] {
  return CONTACTS.map((c) => ({ jid: c.jid, name: c.name, subscription: 'both', groups: [] }))
}

// seeded PEP bookmarks: the lobby room autojoins, a second room sits in
// the list waiting, and one contact bookmark shows the contact kind
export function demoBookmarks(): Bookmark[] {
  return [
    { jid: ROOM, kind: 'conference', name: 'Badinage lobby', autojoin: true, nick: 'you' },
    { jid: 'random@conference.badinage.local', kind: 'conference', name: 'Random' },
    { jid: 'aria@badinage.local', kind: 'contact', name: 'Aria' }
  ]
}

// the occupants a joined room pretends to have: our own self presence
// plus the fixed lobby cast. We join as owner/moderator so every
// moderation and configuration control is reachable in demo mode, and
// everyone carries a real jid plus an XEP-0421 occupant id because the
// demo room is non-anonymous.
export function roomOccupants(room: string, selfNick: string, selfJid = ''): MucOccupant[] {
  return [
    {
      room,
      nick: selfNick,
      presence: 'online',
      affiliation: 'owner',
      role: 'moderator',
      self: true,
      codes: ['110'],
      jid: selfJid || undefined,
      occupantId: 'occ-self'
    },
    ...ROOM_OCCUPANTS.map((o) => ({
      room,
      nick: o.nick,
      presence: 'online',
      affiliation: o.affiliation,
      role: o.role,
      self: false,
      codes: [] as string[],
      jid: `${o.nick}@badinage.local`,
      occupantId: `occ-${o.nick}`, avatarHash: `${o.nick}@badinage.local`
    }))
  ]
}

// XEP-0004 fixture for the owner configuration dialog: one field per
// rendered widget type so every branch of the generic form shows.
export function demoRoomConfig(): DataForm {
  return {
    title: 'Room configuration',
    instructions: 'Adjust how the lobby behaves.',
    fields: [
      {
        var: 'FORM_TYPE',
        type: 'hidden',
        required: false,
        values: ['http://jabber.org/protocol/muc#roomconfig'],
        options: []
      },
      {
        var: 'muc#roomconfig_roomname',
        type: 'text-single',
        label: 'Room name',
        required: false,
        values: ['Lobby'],
        options: []
      },
      {
        var: 'muc#roomconfig_roomdesc',
        type: 'text-single',
        label: 'Description',
        desc: 'Shown in room listings',
        required: false,
        values: ['Badinage lobby'],
        options: []
      },
      {
        var: 'muc#roomconfig_persistentroom',
        type: 'boolean',
        label: 'Persistent room',
        required: false,
        values: ['1'],
        options: []
      },
      {
        var: 'muc#roomconfig_membersonly',
        type: 'boolean',
        label: 'Members only',
        desc: 'Only members may join',
        required: false,
        values: ['0'],
        options: []
      },
      {
        var: 'muc#roomconfig_whois',
        type: 'list-single',
        label: 'Who can see real addresses',
        required: false,
        values: ['moderators'],
        options: [
          { value: 'moderators', label: 'Moderators only' },
          { value: 'anyone', label: 'Anyone' }
        ]
      },
      {
        var: 'muc#roomconfig_roomadmins',
        type: 'jid-multi',
        label: 'Room admins',
        required: false,
        values: ['cleo@badinage.local'],
        options: []
      }
    ]
  }
}

export function emitContactPresence(events: DemoEmitter): void {
  for (const contact of CONTACTS) {
    // a stable per-contact hash keeps the demo avatar fetch path running
    events.emit('presence', {
      from: contact.jid,
      show: contact.presence,
      status: contact.status,
      avatarHash: contact.jid
    })
  }
}

export function emitDmHistory(events: DemoEmitter, jid: string): void {
  for (const [peer, history] of Object.entries(DM_HISTORY)) {
    for (const m of history) {
      events.emit('message', {
        from: m.who === 'me' ? jid : peer,
        to: m.who === 'me' ? peer : jid,
        body: m.body,
        type: 'chat',
        stanzaId: m.stanzaId,
        delay: ago(m.agoMin),
        carbon: m.who === 'me' ? 'sent' : undefined,
        replyTo: m.replyTo,
        replaceId: m.replaceId,
        attachments: m.attachments,
        signed: m.signed,
        spoilerHint: m.spoilerHint
      })
    }
  }
}

export function emitRoomHistory(events: DemoEmitter, jid: string): void {
  for (const m of ROOM_HISTORY) {
    events.emit('message', {
      from: `${ROOM}/${m.nick}`,
      to: jid,
      body: m.body,
      type: 'groupchat',
      nick: m.nick,
      stanzaId: m.stanzaId,
      delay: ago(m.agoMin),
      attachments: m.attachments,
      spoilerHint: m.spoilerHint
    })
  }
  // cleo reacts to wren's last room message
  events.emit('message', {
    from: `${ROOM}/cleo`,
    to: jid,
    body: '',
    type: 'groupchat',
    nick: 'cleo',
    stanzaId: 'room-8',
    delay: ago(5),
    reactionTo: { id: 'room-7', emojis: ['❤️'] }
  })
}

// Scripted live traffic a few seconds in: a fresh unread, a pending
// subscription request, a reaction, then a second dm from another
// contact.
export function scheduleLiveEvents(
  events: DemoEmitter,
  jid: string,
  uniqueId: (prefix: string) => string,
  schedule: (fn: () => void, ms: number) => void
): void {
  const esmeStanzaId = uniqueId('live')
  schedule(() => {
    events.emit('message', {
      from: 'esme@badinage.local',
      to: jid,
      body: 'hey, is this the new client?',
      type: 'chat',
      stanzaId: esmeStanzaId
    })
  }, DEMO_LIVE_MESSAGE_DELAY_MS)
  schedule(() => {
    events.emit('subscriptionRequest', {
      from: 'wren@badinage.local',
      status: 'would like to chat'
    })
  }, DEMO_SUBSCRIPTION_REQUEST_DELAY_MS)
  schedule(() => {
    // aria reacts to our release notes message a few seconds in
    events.emit('message', {
      from: 'aria@badinage.local',
      to: jid,
      body: '',
      type: 'chat',
      stanzaId: uniqueId('live'),
      reactionTo: { id: 'd-hist-aria-4', emojis: ['🎉'] }
    })
  }, DEMO_LIVE_REACTION_DELAY_MS)
  schedule(() => {
    // a second live dm from a different contact shortly after esme's
    events.emit('message', {
      from: 'benedikt@badinage.local',
      to: jid,
      body: 'back from lunch, the deploy looks clean',
      type: 'chat',
      stanzaId: uniqueId('live')
    })
  }, DEMO_SECOND_LIVE_MESSAGE_DELAY_MS)
  schedule(() => {
    // a direct XEP-0249 invite so the accept/decline flow is visible
    events.emit('roomInvite', {
      room: INVITE_ROOM,
      from: 'aria@badinage.local',
      kind: 'direct',
      reason: 'quieter room for release talk'
    })
  }, DEMO_ROOM_INVITE_DELAY_MS)
  schedule(() => {
    // esme thinks better of her message and retracts it. Her stanza id
    // names the target so the row becomes a tombstone
    events.emit('message', {
      from: 'esme@badinage.local',
      to: jid,
      body: '',
      type: 'chat',
      stanzaId: uniqueId('live'),
      retractId: esmeStanzaId
    })
  }, DEMO_LIVE_RETRACT_DELAY_MS)
}

// The one older page of history behind every peer, emitted when
// scroll-up paging reaches the end of the seeded scrollback.
export function emitArchivePage(
  events: DemoEmitter,
  jid: string,
  peerJid: string,
  isRoom: boolean
): void {
  if (isRoom) {
    for (const [i, entry] of ROOM_PAGE.entries()) {
      events.emit('message', {
        from: `${peerJid}/${entry.nick}`,
        to: jid,
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
      events.emit('message', {
        from: entry.who === 'me' ? jid : peerJid,
        to: entry.who === 'me' ? peerJid : jid,
        body: entry.body,
        type: 'chat',
        stanzaId: `mam-page-${peerJid}-${i + 1}`,
        mam: true,
        delay: ago(entry.agoMin),
        carbon: entry.who === 'me' ? 'sent' : undefined
      })
    }
  }
}

// a canned peer reply. Rooms answer as the aria occupant
export function emitReply(
  events: DemoEmitter,
  jid: string,
  to: string,
  type: 'chat' | 'groupchat',
  stanzaId: string
): void {
  const isRoom = isRoomTarget(to, type)
  events.emit('message', {
    from: isRoom ? `${ROOM}/aria` : to,
    to: jid,
    body: randomReply(),
    type: isRoom ? 'groupchat' : 'chat',
    nick: isRoom ? 'aria' : undefined,
    stanzaId
  })
}

// echo a reaction back from a peer so the demo shows a live update
export function emitReactionEcho(
  events: DemoEmitter,
  jid: string,
  to: string,
  type: 'chat' | 'groupchat',
  targetId: string,
  emojis: string[],
  stanzaId: string
): void {
  const isRoom = isRoomTarget(to, type)
  events.emit('message', {
    from: isRoom ? `${ROOM}/aria` : to,
    to: jid,
    body: '',
    type: isRoom ? 'groupchat' : 'chat',
    nick: isRoom ? 'aria' : undefined,
    stanzaId,
    reactionTo: { id: targetId, emojis }
  })
}

// flag the echo as encrypted so the lock icon shows in demo
export function emitEncryptedReply(
  events: DemoEmitter,
  jid: string,
  to: string,
  stanzaId: string
): void {
  events.emit('message', {
    from: to,
    to: jid,
    body: randomReply(),
    type: 'chat',
    stanzaId,
    encrypted: true
  })
}

// peer starts typing back a beat later
export function emitTypingEcho(events: DemoEmitter, jid: string, to: string): void {
  events.emit('message', {
    from: to,
    to: jid,
    body: '',
    type: 'chat',
    chatState: 'composing'
  })
}

// demo contacts always accept a subscribe after a beat
export function emitSubscriptionAccept(events: DemoEmitter, to: string): void {
  events.emit('rosterUpdate', {
    jid: to,
    name: '',
    subscription: 'both',
    groups: []
  })
  events.emit('presence', { from: to, show: 'online', status: '' })
}

// Real in-memory OMEMO managers stand in for contacts so fingerprints,
// bundles and the trust flow are exercised end to end in demo mode.
export class DemoOmemoPeers {
  private managers = new Map<string, Promise<OmemoManager>>()

  private managerFor(jid: string): Promise<OmemoManager> {
    let pending = this.managers.get(jid)
    if (!pending) {
      pending = OmemoManager.create({
        namespace: 'omemo2',
        store: new InMemoryOmemoStore(),
        ownJid: jid
      })
      this.managers.set(jid, pending)
    }
    return pending
  }

  private static itemsElement(node: string, payloadXml: string): Element | null {
    const doc = new DOMParser().parseFromString(
      `<items node="${node}"><item id="current">${payloadXml}</item></items>`,
      'text/xml'
    )
    return doc.documentElement
  }

  // only contacts publish fake devices. Our own list stays honest so
  // publishOwn does not pick up a phantom self device
  get(
    node: string,
    jid: string | undefined,
    ownJid: string,
    onDone: (items: Element | null) => void
  ): void {
    const peer = jid ?? ''
    if (!peer || peer === ownJid.split('/')[0]) {
      onDone(null)
      return
    }
    void this.managerFor(peer).then(async (manager) => {
      if (node === NS_OMEMO2_DEVICES) {
        onDone(
          DemoOmemoPeers.itemsElement(
            node,
            `<devices xmlns="${NS_OMEMO2_DEVICES}"><device id="${manager.deviceId}"/></devices>`
          )
        )
        return
      }
      if (node.startsWith(NS_OMEMO2_BUNDLES)) {
        const bundle = serializeXml(await manager.buildBundle())
        onDone(DemoOmemoPeers.itemsElement(node, bundle))
        return
      }
      onDone(null)
    })
  }
}
