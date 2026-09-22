// Fixture tables for demo mode: contacts, occupants, seeded history,
// the canned reply pool and the one extra archive page per peer. Emit
// helpers that push these through a DemoEmitter live in emit.ts.

import type { IncomingMessage } from '../stanzas'

export const ROOM = 'lobby@conference.badinage.local'
export const ROOM_SUBJECT = 'Badinage lobby: be nice'
// the invite scheduled a few seconds in points at this room
export const INVITE_ROOM = 'lounge@conference.badinage.local'
// base-aware icon url. A root-relative path 404s under a subpath deploy
const ICON_URL = `${import.meta.env.BASE_URL}icons/icon-192.png`

// delays for the scripted live traffic emitted by scheduleLiveEvents
export const DEMO_LIVE_MESSAGE_DELAY_MS = 2500
export const DEMO_SUBSCRIPTION_REQUEST_DELAY_MS = 4000
export const DEMO_LIVE_REACTION_DELAY_MS = 5000
export const DEMO_SECOND_LIVE_MESSAGE_DELAY_MS = 5500
export const DEMO_ROOM_INVITE_DELAY_MS = 7000
export const DEMO_LIVE_RETRACT_DELAY_MS = 9000

export const CONTACTS: { jid: string; name: string; presence: string; status: string }[] = [
  { jid: 'aria@badinage.local', name: 'Aria', presence: 'online', status: 'around' },
  { jid: 'benedikt@badinage.local', name: 'Benedikt', presence: 'away', status: 'lunch' },
  { jid: 'cleo@badinage.local', name: 'Cleo', presence: 'online', status: '' },
  { jid: 'dmitri@badinage.local', name: 'Dmitri', presence: 'dnd', status: 'heads down' },
  { jid: 'esme@badinage.local', name: 'Esmé', presence: 'xa', status: 'offline-ish' }
]

export const ROOM_OCCUPANTS = [
  { nick: 'aria', affiliation: 'member', role: 'participant' },
  { nick: 'cleo', affiliation: 'admin', role: 'moderator' },
  { nick: 'dmitri', affiliation: 'member', role: 'participant' },
  { nick: 'wren', affiliation: 'none', role: 'visitor' }
]

export type DmHistoryEntry = {
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

export const DM_HISTORY: Record<string, DmHistoryEntry[]> = {
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

export const ROOM_HISTORY: {
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
export const DM_PAGE: { who: 'them' | 'me'; body: string; agoMin: number }[] = [
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

export const ROOM_PAGE: { nick: string; body: string; agoMin: number }[] = [
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

export function ago(minutes: number): number {
  return Date.now() - minutes * 60_000
}

export function randomReply(): string {
  return REPLIES[Math.floor(Math.random() * REPLIES.length)] ?? 'ack'
}

// a target counts as a room when the message type says so or the jid
// points at the conference service
export function isRoomTarget(to: string, type: 'chat' | 'groupchat'): boolean {
  return type === 'groupchat' || to === ROOM || to.includes('@conference.')
}
