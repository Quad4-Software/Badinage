// Address bridging: the app layer speaks JIDs, IRC speaks nicks and
// channel names. IRC peers get a synthetic bare jid localpart@domain
// where localpart is the casemapped nick or channel name and domain is
// the network identifier the account logged in under. This keeps
// storage scoping, conversation keys and the ui untouched.

import { ircLower, type CaseMapping } from './line'

// ISUPPORT (numeric 005) tokens we care about
export interface ISupport {
  chantypes: string
  prefixModes: string
  prefixChars: string
  casemapping: CaseMapping
  monitor: number
  chathistory: number
  network: string
}

export function defaultISupport(): ISupport {
  return {
    chantypes: '#&',
    prefixModes: 'ov',
    prefixChars: '@+',
    casemapping: 'rfc1459',
    monitor: 0,
    chathistory: 0,
    network: ''
  }
}

// parse the parameter list of a 005 numeric into the support map.
// tokens after "are supported by this server" are skipped.
export function parseIsupport(isupport: ISupport, params: string[]): void {
  for (const raw of params) {
    if (raw.includes(' ')) continue
    const eq = raw.indexOf('=')
    const key = (eq === -1 ? raw : raw.slice(0, eq)).toUpperCase()
    const value = eq === -1 ? '' : raw.slice(eq + 1)
    switch (key) {
      case 'CHANTYPES':
        if (value) isupport.chantypes = value
        break
      case 'PREFIX': {
        // form (ov)@+ : modes inside parens, chars after
        const match = /^\(([^)]*)\)(.*)$/.exec(value)
        if (match) {
          isupport.prefixModes = match[1] ?? 'ov'
          isupport.prefixChars = match[2] ?? '@+'
        }
        break
      }
      case 'CASEMAPPING':
        if (value === 'ascii' || value === 'strict-rfc1459' || value === 'rfc1459') {
          isupport.casemapping = value
        }
        break
      case 'MONITOR':
        isupport.monitor = Number.parseInt(value, 10) || 0
        break
      case 'CHATHISTORY':
        isupport.chathistory = Number.parseInt(value, 10) || 0
        break
      case 'NETWORK':
        isupport.network = value
        break
    }
  }
}

// synthetic bare jid for an IRC target. Channel names and nicks both
// sit in the localpart. Callers distinguish them via isChannelTarget.
export function targetToJid(target: string, domain: string, isupport: ISupport): string {
  return `${ircLower(target, isupport.casemapping)}@${domain}`
}

// IRC target a jid addresses: the localpart before the last @. Jids
// the ui passes always carry our domain. Anything malformed falls back
// to the raw string so the wire command still makes a best effort.
export function jidToTarget(jid: string): string {
  const slash = jid.indexOf('/')
  const bare = slash === -1 ? jid : jid.slice(0, slash)
  const at = bare.lastIndexOf('@')
  return at === -1 ? bare : bare.slice(0, at)
}

export function isChannelTarget(target: string, isupport: ISupport): boolean {
  return target.length > 0 && isupport.chantypes.includes(target[0] ?? '')
}

// presence affiliation/role from NAMES prefix chars (@%+...)
export function prefixToRole(
  prefixes: string,
  isupport: ISupport
): { affiliation: string; role: string } {
  // strongest prefix wins. prefixChars is ordered by power descending
  for (let i = 0; i < isupport.prefixChars.length; i++) {
    const char = isupport.prefixChars[i]
    if (!char || !prefixes.includes(char)) continue
    const mode = isupport.prefixModes[i] ?? ''
    if (mode === 'q') return { affiliation: 'owner', role: 'moderator' }
    if (mode === 'a' || mode === 'o') return { affiliation: 'admin', role: 'moderator' }
    if (mode === 'h') return { affiliation: 'member', role: 'moderator' }
    return { affiliation: 'member', role: 'participant' }
  }
  return { affiliation: 'member', role: 'participant' }
}

// numerics the transport dispatches on. Only the ones referenced
// outside this file are exported
export const RPL_WELCOME = '001'
export const RPL_ISUPPORT = '005'
export const RPL_NOTOPIC = '331'
export const RPL_TOPIC = '332'
export const RPL_NAMREPLY = '353'
export const RPL_LIST = '322'
export const RPL_LISTEND = '323'
const ERR_NOSUCHCHANNEL = '403'
const ERR_CANNOTSENDTOCHAN = '404'
const ERR_TOOMANYCHANNELS = '405'
export const ERR_ERRONEUSNICKNAME = '432'
export const ERR_NICKNAMEINUSE = '433'
const ERR_NEEDREGGEDNICK = '477'
const ERR_BANNEDFROMCHAN = '474'
const ERR_CHANNELISFULL = '471'
const ERR_INVITEONLYCHAN = '473'
const ERR_BADCHANNELKEY = '475'
const ERR_BADCHANMASK = '476'
export const ERR_PASSWDMISMATCH = '464'
export const ERR_SASLFAIL = '904'
export const RPL_SASLSUCCESS = '903'
export const ERR_SASLTOOLONG = '905'
export const ERR_SASLABORTED = '906'
export const ERR_SASLALREADY = '907'
export const ERR_SASLMECHS = '908'
export const RPL_MONONLINE = '730'
export const RPL_MONOFFLINE = '731'

// join-failure numerics -> a presenceError condition the room banner
// can phrase. Codes stay the raw numeric so detail survives.
export const JOIN_ERROR_CONDITIONS: Record<string, string> = {
  [ERR_NOSUCHCHANNEL]: 'item-not-found',
  [ERR_TOOMANYCHANNELS]: 'resource-constraint',
  [ERR_CHANNELISFULL]: 'resource-constraint',
  [ERR_INVITEONLYCHAN]: 'registration-required',
  [ERR_BANNEDFROMCHAN]: 'forbidden',
  [ERR_BADCHANNELKEY]: 'not-authorized',
  [ERR_BADCHANMASK]: 'bad-request',
  [ERR_NEEDREGGEDNICK]: 'registration-required',
  [ERR_CANNOTSENDTOCHAN]: 'not-acceptable'
}
