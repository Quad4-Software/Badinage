// XEP-0080 geoloc send path for the composer: encrypt the geo uri body
// like any other message, then push the outgoing row. Extracted for the
// size gate.

import { get } from 'svelte/store'

import type { Geoloc } from '$lib/core/xmpp/stanzas'
import LL from '$lib/i18n/i18n-svelte'

import type { Account } from '$lib/state/accounts.svelte'
import { app } from '$lib/state/app.svelte'
import type { Conversation, ConversationKind } from '$lib/state/chats.svelte'
import { geoUri } from '$lib/utils/protocol/geo'
import { toast } from '$lib/ui/primitives/sonner'

export async function sendGeoloc(
  account: Account,
  peerJid: string,
  kind: ConversationKind,
  conversation: Conversation | undefined,
  geoloc: Geoloc
): Promise<void> {
  const current = account
  const body = geoUri(geoloc.lat, geoloc.lon)
  const type = kind === 'muc' ? 'groupchat' : 'chat'
  const encryption = conversation?.encryption ?? 'auto'
  // same eligibility rule as the text send path: members-only and
  // non-anonymous with real jids for every occupant
  const members = [...(conversation?.occupants.values() ?? [])].filter((o) => !o.self)
  const roomEncrypted =
    encryption !== 'none' &&
    kind === 'muc' &&
    conversation?.roomInfo?.membersOnly === true &&
    conversation.roomInfo.anonymous === false &&
    members.length > 0 &&
    members.every((o) => o.jid !== undefined)
  let encryptedXml: string | null = null
  if (encryption !== 'none' && (type === 'chat' || roomEncrypted)) {
    const omemo = current.omemo ?? (await current.omemoService())
    if (omemo) {
      try {
        encryptedXml = roomEncrypted
          ? await omemo.encryptRoomBody(
              peerJid,
              members.map((o) => o.jid ?? ''),
              body,
              { geoloc, ephemeral: conversation?.ephemeralTimer }
            )
          : await omemo.encryptBody(peerJid, body, {
              geoloc,
              ephemeral: conversation?.ephemeralTimer
            })
      } catch {
        toast.error(get(LL).encryptFailed())
        return
      }
    }
  }
  // a required-encryption conversation never downgrades a location share
  if (encryption === 'omemo' && encryptedXml === null) {
    toast.error(get(LL).encryptFailed())
    return
  }
  const encrypted = encryptedXml !== null
  const id = encryptedXml
    ? current.connection.sendEncryptedMessage(peerJid, encryptedXml)
    : current.connection.sendChatMessage(peerJid, body, type, {
        geoloc,
        ephemeral: conversation?.ephemeralTimer
      })
  const store = app.chatsFor(current.jid)
  const conv = store.open(peerJid)
  conv.encrypted = encrypted
  store.push(peerJid, {
    id,
    wireId: id,
    peerJid,
    body,
    outgoing: true,
    timestamp: Date.now(),
    encrypted,
    delivered: false,
    read: false,
    reactions: {},
    geoloc,
    nick: kind === 'muc' ? (conv.ourNick ?? undefined) : undefined
  })
}
