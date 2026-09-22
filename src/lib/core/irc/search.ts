// Channel discovery and search for the IRC transport: the account
// domain poses as the one search service for the explore dialog,
// backed by LIST and the CHANNEL_SEARCH_FEATURE disco flag.

import { CHANNEL_SEARCH_FEATURE } from '$lib/core/xmpp/features/search'
import type { ChannelSearchItem, DataForm, DiscoInfo, DiscoItem } from '$lib/core/xmpp/stanzas'
import { bareJid } from '$lib/utils/jid'

import { targetToJid, type ISupport } from './address'
import type { IrcLink } from './transport'

export function discoItems(
  domain: string,
  jid: string,
  onDone: (items: DiscoItem[] | null) => void
): void {
  onDone(bareJid(jid) === domain ? [{ jid: domain }] : [])
}

export function discoInfo(
  domain: string,
  jid: string,
  onDone: (info: DiscoInfo | null) => void
): void {
  onDone(
    bareJid(jid) === domain
      ? { identities: [], features: [CHANNEL_SEARCH_FEATURE], forms: [] }
      : null
  )
}

export function channelSearch(
  link: IrcLink,
  domain: string,
  isupport: ISupport,
  form: DataForm,
  onDone: (items: ChannelSearchItem[] | null) => void
): void {
  const q = form.fields
    .find((field) => field.var === 'q')
    ?.values[0]?.trim()
    .replace(/[*?\s]+/g, '')
  const mask = q ? `*${q}*` : undefined
  const ok = link.listChannels(mask, (items) =>
    onDone(
      items?.map((item) => ({
        address: targetToJid(item.channel, domain, isupport),
        name: item.channel,
        ...(item.topic ? { description: item.topic } : {}),
        nusers: item.users
      })) ?? null
    )
  )
  if (!ok) onDone(null)
}
