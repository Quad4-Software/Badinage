export interface ParsedJid {
  local?: string
  domain: string
  resource?: string
}

export function parseJid(jid: string): ParsedJid {
  const slash = jid.indexOf('/')
  const bare = slash === -1 ? jid : jid.slice(0, slash)
  const resource = slash === -1 ? undefined : jid.slice(slash + 1)
  const at = bare.lastIndexOf('@')
  const parsed: ParsedJid =
    at === -1 ? { domain: bare } : { local: bare.slice(0, at), domain: bare.slice(at + 1) }
  if (resource) parsed.resource = resource
  return parsed
}

export function bareJid(jid: string): string {
  const slash = jid.indexOf('/')
  return slash === -1 ? jid : jid.slice(0, slash)
}

export function jidDomain(jid: string): string {
  return parseJid(jid).domain
}

export function jidResource(jid: string): string | undefined {
  return parseJid(jid).resource
}

export function isValidBareJid(jid: string): boolean {
  const { local, domain } = parseJid(jid)
  return domain.length > 0 && (local === undefined || local.length > 0)
}

export function isValidUserJid(jid: string): boolean {
  const { local, domain } = parseJid(jid)
  return local !== undefined && local.length > 0 && domain.length > 0
}
