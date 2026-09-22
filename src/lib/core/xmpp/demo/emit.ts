// Scripted demo traffic over a DemoEmitter: seeded history, the live
// event schedule, the extra archive page and canned peer replies.

import type { Emitter } from '$lib/core/events'

import type { ConnectionEvents } from '../connection'

import {
  ago,
  CONTACTS,
  DEMO_LIVE_MESSAGE_DELAY_MS,
  DEMO_LIVE_REACTION_DELAY_MS,
  DEMO_LIVE_RETRACT_DELAY_MS,
  DEMO_ROOM_INVITE_DELAY_MS,
  DEMO_SECOND_LIVE_MESSAGE_DELAY_MS,
  DEMO_SUBSCRIPTION_REQUEST_DELAY_MS,
  DM_HISTORY,
  DM_PAGE,
  INVITE_ROOM,
  isRoomTarget,
  randomReply,
  ROOM,
  ROOM_HISTORY,
  ROOM_PAGE
} from './fixtures'

export type DemoEmitter = Emitter<ConnectionEvents>

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
