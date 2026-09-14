// Conversation-level slash commands (converse-style): /clear, /leave,
// /nick, /topic, /invite, /join run against the store or room and never
// reach the wire. Unknown commands get an error toast and are not sent.
// the message-level commands pass through so send.ts can emit a body.

import { get } from 'svelte/store'

import LL from '$lib/i18n/i18n-svelte'
import { app } from '$lib/state/app.svelte'
import { extApi } from '$lib/state/app/ext-api.svelte'
import { toast } from '$lib/ui/primitives/sonner'
import type { SlashCommand } from '$lib/utils/message-commands'

import type { SendOpts } from './send'

// message-level commands produce a body. Send.ts owns them
const PASSTHROUGH = new Set(['me', 'spoiler'])

const ROOM_ONLY = new Set(['leave', 'nick', 'topic', 'invite'])

function usage(text: string): void {
  toast.error(get(LL).cmdUsage({ usage: text }))
}

// Returns true when the input was consumed (executed or rejected with
// a toast), false when the body should be sent as a normal message,
// or {body} when an extension command produced text to send instead.
export async function runSlashCommand(
  opts: SendOpts,
  command: SlashCommand
): Promise<boolean | { body: string }> {
  if (PASSTHROUGH.has(command.name)) return false
  const { account, peerJid, kind, conversation } = opts

  if (ROOM_ONLY.has(command.name) && kind !== 'muc') {
    toast.error(get(LL).cmdRoomOnly({ name: command.name }))
    return true
  }

  switch (command.name) {
    case 'clear':
      app.chatsFor(account.jid).clearHistory(peerJid)
      toast.success(get(LL).historyCleared())
      return true
    case 'join':
      app.joinRoomOpen = true
      return true
    case 'leave':
      if (conversation?.ourNick) account.leaveRoom(peerJid, conversation.ourNick)
      return true
    case 'nick':
      if (!command.args || !conversation?.ourNick) {
        usage('/nick <new nickname>')
        return true
      }
      account.connection.changeRoomNick(
        peerJid,
        conversation.ourNick,
        command.args,
        conversation.password
      )
      return true
    case 'topic':
      account.connection.setRoomSubject(peerJid, command.args)
      return true
    case 'invite': {
      const jid = command.args.split(/\s+/)[0] ?? ''
      if (!jid) {
        usage('/invite <address>')
        return true
      }
      // the stored room password rides along so protected rooms stay
      // joinable from the invite alone
      account.connection.inviteToRoom(peerJid, jid, { password: conversation?.password })
      toast.success(get(LL).inviteSent())
      return true
    }
    default: {
      // extension commands only run on the first dispatch: a returned
      // body never re-parses as a command, so no recursion loop exists
      if ((opts.depth ?? 0) === 0) {
        const result = await extApi.runCommand(command.name, {
          name: command.name,
          args: command.args,
          accountJid: account.jid,
          peerJid,
          kind
        })
        if (result.handled) {
          return result.body === undefined ? true : { body: result.body }
        }
      }
      toast.error(get(LL).cmdUnknown({ name: command.name }))
      return true
    }
  }
}
