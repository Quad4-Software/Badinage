// The composer's send path: spoiler parsing, the edit (correction) and
// new-message branches, OMEMO wrapping, and the optimistic local row.
// Returns true when the stanza left. Extracted for the size gate.

import { get } from 'svelte/store'

import LL from '$lib/i18n/i18n-svelte'
import type { Account } from '$lib/state/accounts.svelte'
import { app } from '$lib/state/app.svelte'
import type { Conversation, ConversationKind } from '$lib/state/chats.svelte'
import type { ComposerContext } from '$lib/state/composer.svelte'
import { bareJid } from '$lib/utils/jid'
import { parseSlashCommand, parseSpoilerCommand } from '$lib/utils/message-commands'
import { toast } from '$lib/ui/primitives/sonner'

import { runSlashCommand } from './commands'
import { mentionRefs } from './mentions'

export interface SendOpts {
  account: Account
  peerJid: string
  kind: ConversationKind
  conversation: Conversation | undefined
  ctx: ComposerContext
  text: string
  // set on the recursion an extension command produces: extension
  // dispatch only runs at depth 0 so a returned body can never loop
  depth?: number
}

export async function sendText(opts: SendOpts): Promise<boolean> {
  const { account, peerJid, kind, conversation, ctx, text } = opts
  const type = kind === 'muc' ? 'groupchat' : 'chat'
  // conversation-level slash commands (/clear, /leave, /nick, /topic,
  // /invite, /join) act on the room or store and never become a body.
  // /me and /spoiler fall through to the normal send path
  const command = parseSlashCommand(text)
  if (command) {
    const result = await runSlashCommand(opts, command)
    if (result === true) return true
    if (result !== false) return sendText({ ...opts, text: result.body, depth: 1 })
  }
  // XEP-0382 slash command: "/spoiler [hint] text" hides text behind a
  // spoiler with the bracketed hint, "/spoiler text" is hintless. A
  // plain "/me ..." stays literal on the wire. The render side splits it.
  const spoiler = parseSpoilerCommand(text)
  const body = spoiler?.body ?? text

  if (ctx.editing) {
    const ref = ctx.editing.wireId ?? ctx.editing.id
    let sent = false
    if (type === 'chat') {
      const omemo = account.omemo ?? (await account.omemoService())
      if (omemo) {
        try {
          // the correction rides inside the SCE envelope. The wire
          // stanza never carries a cleartext replace element
          const xml = await omemo.encryptBody(peerJid, body, {
            replaceId: ref,
            spoilerHint: spoiler?.hint,
            ephemeral: conversation?.ephemeralTimer
          })
          if (xml !== null) {
            account.connection.sendEncryptedMessage(peerJid, xml)
            sent = true
          }
        } catch {
          // never downgrade a correction to plaintext on encrypt failure
          toast.error(get(LL).encryptFailed())
          return false
        }
      }
    }
    if (!sent) {
      account.connection.sendChatMessage(peerJid, body, type, {
        replaceId: ref,
        spoilerHint: spoiler?.hint,
        ephemeral: conversation?.ephemeralTimer
      })
    }
    app
      .chatsFor(account.jid)
      .applyCorrection(peerJid, ctx.editing.id, body, Date.now(), spoiler?.hint)
    return true
  }

  const replyTo = ctx.replyTo
  // XEP-0461: in MUC the referenced id is the room stanza-id (stored as
  // message.id), in DMs the wire id attribute
  const wireRef = replyTo
    ? kind === 'muc'
      ? replyTo.id
      : (replyTo.wireId ?? replyTo.id)
    : undefined
  // XEP-0461: the reply 'to' attribute names the author of the quoted
  // stanza - our own bare jid when we quote ourselves
  const replyRef =
    replyTo && wireRef
      ? { id: wireRef, to: replyTo.outgoing ? bareJid(account.jid) : peerJid }
      : undefined
  // XEP-0372 mention references (muc) and the XEP-0466 timer the
  // conversation currently negotiates ride on both send paths
  const references = mentionRefs(conversation, kind, body)
  const ephemeral = conversation?.ephemeralTimer
  // group omemo needs a members-only non-anonymous room: members-only
  // keeps the recipient set bounded to affiliated users and real jids
  // are how their devices are enumerated. The disco probe may not have
  // landed yet, in which case the room still sends plaintext
  const members = [...(conversation?.occupants.values() ?? [])].filter((o) => !o.self)
  const roomEncrypted =
    kind === 'muc' &&
    conversation?.roomInfo?.membersOnly === true &&
    conversation.roomInfo.anonymous === false &&
    members.length > 0 &&
    // every occupant must expose a real jid: anyone missing could not
    // read the stanza, so partial coverage sends plaintext instead
    members.every((o) => o.jid !== undefined)
  // encrypt when the peer publishes omemo devices. Falls back to
  // plaintext when there are none or every device is distrusted
  let encryptedXml: string | null = null
  if (type === 'chat' || roomEncrypted) {
    // await the in-flight service creation so a message sent right
    // after connect is still encrypted
    const omemo = account.omemo ?? (await account.omemoService())
    if (omemo) {
      try {
        // null means the peer publishes no usable devices. A thrown
        // error is a real failure and must not downgrade to plaintext.
        // The reply reference and spoiler marker travel inside the
        // envelope with the body. For rooms the recipient set is every
        // member's real jid and null also covers members without
        // usable devices, which cannot read the stanza anyway
        encryptedXml = roomEncrypted
          ? await omemo.encryptRoomBody(
              peerJid,
              members.map((o) => o.jid ?? ''),
              body,
              { replyTo: replyRef, spoilerHint: spoiler?.hint, ephemeral }
            )
          : await omemo.encryptBody(peerJid, body, {
              replyTo: replyRef,
              spoilerHint: spoiler?.hint,
              ephemeral
            })
      } catch {
        toast.error(get(LL).encryptFailed())
        return false
      }
    }
  }
  const encrypted = encryptedXml !== null
  const id = encryptedXml
    ? account.connection.sendEncryptedMessage(peerJid, encryptedXml, type)
    : account.connection.sendChatMessage(peerJid, body, type, {
        replyTo: replyRef,
        spoilerHint: spoiler?.hint,
        references,
        ephemeral
      })
  const store = app.chatsFor(account.jid)
  const conv = store.open(peerJid)
  // keep the flag honest: a peer that removed its device list drops
  // the conversation back to plaintext
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
    spoilerHint: spoiler?.hint,
    replyTo: replyTo
      ? {
          id: replyTo.id,
          from: replyTo.outgoing ? (conv.ourNick ?? account.jid) : (replyTo.nick ?? peerJid),
          quote: replyTo.body
        }
      : undefined,
    nick: kind === 'muc' ? (conv.ourNick ?? undefined) : undefined
  })
  return true
}
