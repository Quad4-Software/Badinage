// Conversation actions for the chat view: bookmark, leave, nick change,
// invite, moderation, notify override, ephemeral timer, attention buzz,
// reaction sets and retraction. One factory so chat-view.svelte stays
// under the size gate. Behavior is identical.

import { get } from 'svelte/store'

import LL from '$lib/i18n/i18n-svelte'
import type { NotifySetting } from '$lib/core/xmpp/stanzas'
import type { Account, RosterContact } from '$lib/state/accounts.svelte'
import { app } from '$lib/state/app.svelte'
import type { ChatMessage, Conversation, EncryptionPreference } from '$lib/state/chats.svelte'
import { toast } from '$lib/ui/primitives/sonner'

export interface ChatActionDeps {
  account: () => Account | undefined
  conversation: () => Conversation | undefined
  isRoom: () => boolean
  contact: () => RosterContact | undefined
  peerBookmarked: () => boolean
  split: () => boolean
  moderateTarget: () => ChatMessage | null
  moderateReason: () => string
  setModerateReason: (v: string) => void
}

export function createChatActions(deps: ChatActionDeps) {
  function senderLabel(sender: string): string {
    const account = deps.account()
    const conversation = deps.conversation()
    if (!account || !conversation) return sender
    if (deps.isRoom()) {
      if (sender === conversation.ourNick || sender === conversation.ourOccupantId) {
        return get(LL).you()
      }
      for (const occupant of conversation.occupants.values()) {
        if (occupant.occupantId === sender || occupant.nick === sender) return occupant.nick
      }
      return sender
    }
    if (sender === account.jid) return get(LL).you()
    return account.roster.find((c) => c.jid === sender)?.name || sender
  }

  function retractMessage(target: ChatMessage | null): void {
    const account = deps.account()
    const conversation = deps.conversation()
    if (!target || !account || !conversation) return
    // dm retractions reference the stanza id attribute. Muc retractions
    // the room stanza-id, which lands in message.id after the echo merge
    const ref = deps.isRoom() ? target.id : (target.wireId ?? target.id)
    account.connection.sendRetraction(
      conversation.peerJid,
      ref,
      deps.isRoom() ? 'groupchat' : 'chat'
    )
    app.chatsFor(account.jid).retract(conversation.peerJid, ref)
  }

  function toggleBookmark(): void {
    const account = deps.account()
    const conversation = deps.conversation()
    if (!account || !conversation) return
    if (deps.peerBookmarked()) {
      account.removeBookmark(conversation.peerJid)
      return
    }
    if (deps.isRoom()) {
      account.addBookmark({
        jid: conversation.peerJid,
        kind: 'conference',
        name: conversation.peerJid.split('@')[0],
        autojoin: true,
        nick: conversation.ourNick
      })
    } else {
      account.addBookmark({
        jid: conversation.peerJid,
        kind: 'contact',
        name: deps.contact()?.name || undefined
      })
    }
  }

  function leaveRoom(): void {
    const account = deps.account()
    const conversation = deps.conversation()
    if (!account || !conversation?.ourNick) return
    account.leaveRoom(conversation.peerJid, conversation.ourNick)
    if (deps.split()) app.splitPeer = null
    else app.activePeer = null
  }

  function changeNick(newNick: string): void {
    const account = deps.account()
    const conversation = deps.conversation()
    if (!account || !conversation?.ourNick) return
    account.connection.changeRoomNick(
      conversation.peerJid,
      conversation.ourNick,
      newNick,
      conversation.password
    )
  }

  function sendInvite(jid: string, reason: string): void {
    const account = deps.account()
    const conversation = deps.conversation()
    if (!account || !conversation) return
    // the stored room password rides along on the direct invite so a
    // password-protected room stays joinable from the invite alone
    account.connection.inviteToRoom(conversation.peerJid, jid, {
      reason: reason || undefined,
      password: conversation.password
    })
    // members-only rooms do not admit invitees by invitation alone.
    // An admin or owner grant of member affiliation is what actually
    // lets them past the door
    const self = [...conversation.occupants.values()].find((o) => o.self)
    if (
      conversation.roomInfo?.membersOnly === true &&
      (self?.affiliation === 'admin' || self?.affiliation === 'owner')
    ) {
      account.connection.grantMembership(conversation.peerJid, jid)
    }
    toast.success(get(LL).inviteSent())
  }

  function doModerate(): void {
    const target = deps.moderateTarget()
    const conversation = deps.conversation()
    if (!target || !conversation) return
    // moderation addresses the room stanza-id, which message.id holds
    deps
      .account()
      ?.connection.moderateMessage(
        conversation.peerJid,
        target.id,
        deps.moderateReason() || undefined
      )
    deps.setModerateReason('')
  }

  // XEP-0492: persist the override locally and mirror it onto the
  // bookmark extension when the conversation is bookmarked so other
  // resources pick it up on the next fetch
  function setNotify(level: NotifySetting | undefined): void {
    const account = deps.account()
    const conversation = deps.conversation()
    if (!account || !conversation) return
    app.chatsFor(account.jid).setNotify(conversation.peerJid, level)
    account.setBookmarkNotify(conversation.peerJid, level)
  }

  // local per-conversation encryption override. Persisted through the
  // store meta so it survives restarts
  function setEncryption(preference: EncryptionPreference): void {
    const account = deps.account()
    const conversation = deps.conversation()
    if (!account || !conversation) return
    app.chatsFor(account.jid).setEncryption(conversation.peerJid, preference)
  }

  function setEphemeral(seconds: number): void {
    const account = deps.account()
    const conversation = deps.conversation()
    if (!account || !conversation) return
    const store = app.chatsFor(account.jid)
    store.setEphemeral(conversation.peerJid, seconds)
    // announce the new timer immediately so the peer negotiates it
    // without waiting for the next typed message. In an encrypted dm
    // the announce rides inside an SCE envelope. A cleartext ephemeral
    // element would leak that the conversation self-destructs.
    if (!deps.isRoom() && conversation.encrypted === true && conversation.encryption !== 'none') {
      const conn = account.connection
      const peer = conversation.peerJid
      void Promise.resolve(account.omemo ?? account.omemoService()).then(async (omemo) => {
        if (!omemo) return
        const xml = await omemo.encryptBody(peer, '', { ephemeral: seconds })
        if (xml) conn.sendEncryptedMessage(peer, xml)
      })
      return
    }
    account.connection.sendChatMessage(
      conversation.peerJid,
      '',
      deps.isRoom() ? 'groupchat' : 'chat',
      { ephemeral: seconds }
    )
  }

  // XEP-0224: nudge the peer. Receivers rate-limit so this is a
  // low-volume signal. We also cap our own sends per conversation.
  function buzz(): void {
    const account = deps.account()
    const conversation = deps.conversation()
    if (!account || !conversation) return
    const store = app.chatsFor(account.jid)
    if (!store.canBuzz(conversation.peerJid)) return
    store.noteBuzz(conversation.peerJid)
    account.connection.sendAttention(conversation.peerJid, deps.isRoom() ? 'groupchat' : 'chat')
    toast.success(get(LL).buzzSent())
  }

  // XEP-0444 reactions. In an encrypted dm the reaction set rides inside
  // an SCE envelope as a bare notification so the emoji and its target id
  // never leak in the clear. Anything else uses the plain stanza.
  function sendReactionSet(target: string, ref: string, emojis: string[]): void {
    const account = deps.account()
    const conversation = deps.conversation()
    if (!account || !conversation) return
    if (
      conversation.kind === 'dm' &&
      conversation.encrypted === true &&
      conversation.encryption !== 'none'
    ) {
      void Promise.resolve(account.omemo ?? account.omemoService())
        .then(async (omemo) => {
          const xml = omemo ? await omemo.encryptReaction(target, ref, emojis) : null
          if (xml !== null) account.connection.sendEncryptedNotification(target, xml)
          else account.connection.sendReaction(target, ref, emojis, 'chat')
        })
        .catch(() => account.connection.sendReaction(target, ref, emojis, 'chat'))
      return
    }
    account.connection.sendReaction(target, ref, emojis, deps.isRoom() ? 'groupchat' : 'chat')
  }

  return {
    senderLabel,
    retractMessage,
    toggleBookmark,
    leaveRoom,
    changeNick,
    sendInvite,
    doModerate,
    setNotify,
    setEphemeral,
    setEncryption,
    buzz,
    sendReactionSet
  }
}
