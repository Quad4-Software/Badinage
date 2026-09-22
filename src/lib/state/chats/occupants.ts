// MUC join bookkeeping and occupant presence for ChatStore: recording
// our join parameters for the rejoin watchdog and folding occupant
// updates into conversation state, including self-rename, kick and ban
// codes. Free functions so chats.svelte.ts stays under the size gate.

import { SELF_BANNED_CODE, SELF_KICKED_CODE, SELF_RENAMED_CODE } from '$lib/core/xmpp/features/muc'
import type { RoomOccupant } from '../conversation.svelte'

import type { ChatStore } from '../chats.svelte'

// remember join parameters so the rejoin watchdog can replay them and
// retry banners can re-send them without asking again
export function noteJoin(chat: ChatStore, room: string, nick: string, password?: string): void {
  const conversation = chat.open(room, 'muc')
  conversation.ourNick = nick
  conversation.ourNicks.add(nick)
  conversation.password = password
  conversation.joinError = undefined
  conversation.kicked = false
  conversation.kickReason = undefined
  conversation.banned = false
}

export function setOccupant(chat: ChatStore, room: string, occupant: RoomOccupant): void {
  const conversation = chat.open(room, 'muc')
  const renamed = occupant.codes.includes(SELF_RENAMED_CODE)
  // offline stanzas without a 110 still leave our nick in the from
  // resource. Online presence gets no such fallback, or a stranger
  // taking our nick after a kick would mark us joined
  const self =
    occupant.self || (occupant.presence === 'offline' && occupant.nick === conversation.ourNick)
  if (occupant.presence === 'offline') {
    conversation.occupants.delete(occupant.nick)
    conversation.typers.delete(occupant.nick)
  } else {
    conversation.occupants.set(occupant.nick, occupant)
  }
  if (!self) return
  if (occupant.presence === 'offline') {
    if (renamed && occupant.newNick) {
      // the departing half of a nick change already names the new
      // nick. Adopt it so pending sends use it immediately
      conversation.ourNick = occupant.newNick
      conversation.ourNicks.add(occupant.newNick)
      return
    }
    conversation.joined = false
    // re-probe room properties on rejoin, they may have changed
    conversation.roomInfo = undefined
    if (occupant.codes.includes(SELF_BANNED_CODE)) {
      conversation.banned = true
      conversation.kicked = false
    } else if (occupant.codes.includes(SELF_KICKED_CODE)) {
      conversation.kicked = true
      conversation.kickReason = occupant.reason
    }
    return
  }
  conversation.joined = true
  conversation.joinError = undefined
  conversation.kicked = false
  conversation.kickReason = undefined
  conversation.banned = false
  conversation.ourNick = occupant.nick
  conversation.ourNicks.add(occupant.nick)
  if (occupant.occupantId) conversation.ourOccupantId = occupant.occupantId
}
