// Stress fixtures for the demo account: enabled with ?stress or
// ?stress=contacts,rooms,messages. Emits a large but believable load -
// roster entries, joined rooms with occupants, and thousands of history
// messages - so profiling, the e2e perf spec and manual QA can push the
// client past what the hand-tuned fixtures cover.
//
// Everything is deterministic: same param, same traffic. Delivery is
// chunked through the scheduler so the event loop stays observable and
// longtasks reflect real per-batch cost instead of one giant block.

import type { Emitter } from '$lib/core/events'

import type { ConnectionEvents } from '../connection'
import { roomOccupants } from '../demo-data'
import type { Bookmark, MucOccupant, RosterItem } from '../stanzas'

type StressEmitter = Emitter<ConnectionEvents>

export interface StressPlan {
  contacts: number
  rooms: number
  messages: number
}

// bare ?stress lands on a middle-sized load, the comma form overrides
const DEFAULT_PLAN: StressPlan = { contacts: 200, rooms: 60, messages: 4000 }
const MAX_PLAN: StressPlan = { contacts: 2000, rooms: 500, messages: 50_000 }

// batches this size keep each scheduled task well under a frame budget
// on desktop while still flooding the ingest path
const STRESS_CHUNK = 400
// occupancy per stress room beyond our own self presence
const STRESS_OCCUPANTS = 3

const STRESS_DOMAIN = 'badinage.local'
const STRESS_CONF = 'conference.badinage.local'

function stressContactJid(index: number): string {
  return `stress-c${index}@${STRESS_DOMAIN}`
}

function stressRoomJid(index: number): string {
  return `stress-room-${index}@${STRESS_CONF}`
}

// Parses the stress flag out of a query string. Returns null when the
// flag is absent and clamps to MAX_PLAN so a typo cannot wedge the tab.
export function stressPlan(search: string): StressPlan | null {
  const raw = new URLSearchParams(search).get('stress')
  if (raw === null) return null
  if (raw === '') return { ...DEFAULT_PLAN }
  const [contacts, rooms, messages] = raw.split(',').map((v) => Number(v) || 0)
  return {
    contacts: Math.min(Math.max(contacts ?? 0, 0), MAX_PLAN.contacts),
    rooms: Math.min(Math.max(rooms ?? 0, 0), MAX_PLAN.rooms),
    messages: Math.min(Math.max(messages ?? 0, 0), MAX_PLAN.messages)
  }
}

export function stressRoster(plan: StressPlan): RosterItem[] {
  const items: RosterItem[] = []
  for (let i = 0; i < plan.contacts; i++) {
    items.push({
      jid: stressContactJid(i),
      name: `Stress Contact ${i}`,
      subscription: 'both',
      groups: i % 10 === 0 ? ['stress'] : []
    })
  }
  return items
}

function stressBookmarks(plan: StressPlan): Bookmark[] {
  const items: Bookmark[] = []
  for (let i = 0; i < plan.rooms; i++) {
    items.push({
      jid: stressRoomJid(i),
      kind: 'conference',
      name: `Stress Room ${i}`,
      autojoin: true,
      nick: 'you'
    })
  }
  return items
}

// deterministic prng so stress runs are reproducible between profiles
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const STRESS_BODIES = [
  'ping from the load generator',
  'shipping the stress fixture now',
  'this conversation is entirely synthetic',
  'still holding up over here',
  'benchmark says hello',
  'anyone else seeing this flood?',
  'deterministic noise, do not reply'
]

// self presence plus a fixed bot cast so occupant lists and nick
// colors have something to chew on
function stressOccupants(room: string, jid: string): MucOccupant[] {
  const members = roomOccupants(room, 'you', jid).slice(0, 1)
  for (let i = 0; i < STRESS_OCCUPANTS; i++) {
    members.push({
      room,
      nick: `bot${i}`,
      presence: 'online',
      affiliation: 'member',
      role: 'participant',
      self: false,
      codes: [],
      occupantId: `occ-${room}-${i}`
    })
  }
  return members
}

// Emits presence for every stress contact, occupants per room, then the
// message flood in scheduled chunks. Stress rooms join the bookmark map
// so they render like server-pushed entries. Progress lands on
// globalThis.__badinageStress so tests can wait for quiescence.
export function emitStress(
  events: StressEmitter,
  jid: string,
  plan: StressPlan | null,
  bookmarks: Map<string, Bookmark>,
  schedule: (fn: () => void, ms: number) => void
): void {
  if (!plan) return
  const rand = mulberry32(0x5eed)

  const added = stressBookmarks(plan)
  for (const bookmark of added) {
    bookmarks.set(bookmark.jid, bookmark)
  }
  events.emit('bookmarks', { updated: added, retracted: [] })

  for (let i = 0; i < plan.contacts; i++) {
    const show = ['chat', 'away', 'xa', 'dnd'][i % 4] ?? 'chat'
    events.emit('presence', { from: stressContactJid(i), show, status: 'load test' })
  }

  for (let i = 0; i < plan.rooms; i++) {
    const room = stressRoomJid(i)
    for (const occupant of stressOccupants(room, jid)) {
      events.emit('occupant', occupant)
    }
  }

  const tracker = { emitted: 0, total: plan.messages }
  ;(globalThis as Record<string, unknown>).__badinageStress = tracker

  let sent = 0
  const emitChunk = () => {
    const end = Math.min(sent + STRESS_CHUNK, plan.messages)
    for (; sent < end; sent++) {
      emitStressMessage(events, jid, plan, sent, rand)
    }
    tracker.emitted = sent
    if (sent < plan.messages) schedule(emitChunk, 0)
  }
  schedule(emitChunk, 0)
}

function emitStressMessage(
  events: StressEmitter,
  jid: string,
  plan: StressPlan,
  index: number,
  rand: () => number
): void {
  // spread the flood over every contact and room so all sidebar paths
  // and conversation stores take load, not just one hot conversation
  const targets = Math.max(plan.contacts + plan.rooms, 1)
  const t = index % targets
  const room = t >= plan.contacts
  const peer = room ? stressRoomJid(t - plan.contacts) : stressContactJid(t)
  const nick = room ? `bot${index % STRESS_OCCUPANTS}` : undefined
  const outgoing = !room && index % 5 === 0
  // ~5% of messages arrive out of order like delayed/mam traffic
  const skew = index % 20 === 19 ? rand() * 6 * 60 * 60 * 1000 : 0
  const delay = Date.now() - (totalWindow(plan, index) + skew)
  const stanzaId = `stress-${index}`

  events.emit('message', {
    from: room ? `${peer}/${nick}` : outgoing ? jid : `${peer}/phone`,
    to: room || !outgoing ? jid : peer,
    body: `s${index} ${STRESS_BODIES[index % STRESS_BODIES.length]}`,
    type: room ? 'groupchat' : 'chat',
    nick,
    stanzaId,
    delay,
    carbon: outgoing ? 'sent' : undefined,
    attachments:
      index % 17 === 3
        ? [
            {
              url: 'https://example.invalid/notes.txt',
              mediaType: 'text/plain',
              name: `notes-${index}.txt`,
              size: 1024 + index
            }
          ]
        : undefined
  })

  // a reaction every so often against the previous message in the same
  // conversation exercises the react path under load
  if (index % 23 === 11 && index > targets) {
    events.emit('message', {
      from: room ? `${peer}/${nick}` : `${peer}/phone`,
      to: jid,
      body: '',
      type: room ? 'groupchat' : 'chat',
      nick,
      stanzaId: `stress-react-${index}`,
      delay: delay + 1000,
      reactionTo: { id: `stress-${index - targets}`, emojis: ['👍'] }
    })
  }
}

// messages land spread across the last two days, oldest first per
// conversation, so most appends hit the O(1) tail path
function totalWindow(plan: StressPlan, index: number): number {
  const span = 48 * 60 * 60 * 1000
  return span - Math.floor((index / Math.max(plan.messages, 1)) * span)
}
