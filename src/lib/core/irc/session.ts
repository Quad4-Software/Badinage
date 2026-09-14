// Registration state machine: CAP negotiation, SASL PLAIN, NICK/USER
// and the nick-in-use fallback. The connection feeds every inbound
// line through handle() until registered fires. Pure sequencing - no
// socket knowledge.

import type { IncomingMessage } from '$lib/core/xmpp/stanzas'

import {
  ERR_ERRONEUSNICKNAME,
  ERR_NICKNAMEINUSE,
  ERR_PASSWDMISMATCH,
  ERR_SASLABORTED,
  ERR_SASLALREADY,
  ERR_SASLFAIL,
  ERR_SASLTOOLONG,
  RPL_SASLSUCCESS,
  RPL_WELCOME
} from './address'
import type { IrcLine } from './line'

// capabilities we ask for when the server offers them
const WANT_CAPS = [
  'sasl',
  'message-tags',
  'server-time',
  'echo-message',
  'batch',
  'labeled-response',
  'draft/chathistory',
  'draft/event-playback',
  'draft/read-marker',
  'draft/multiline',
  'account-tag',
  'account-notify',
  'extended-join',
  'away-notify',
  'invite-notify',
  'multi-prefix',
  'userhost-in-names',
  'cap-notify',
  'setname',
  'chghost'
]

const SASL_MAX_CHUNK = 400
const NICK_FALLBACK_SUFFIX = '_'

export interface SessionHooks {
  send(line: string): void
  // 001 landed: registration complete under this nick
  onRegistered(nick: string): void
  // sasl or password failure. The caller closes the socket
  onAuthFail(): void
  // a fatal numeric with no recovery (e.g. banned), text is the server
  // message
  onError(text: string): void
}

export class IrcSession {
  // caps the server acknowledged. Send paths consult this before
  // emitting tagged commands
  readonly caps = new Set<string>()
  private lsDone = false
  private offered = new Set<string>()
  private saslStarted = false
  private nickFallbackTried = false
  registered = false

  constructor(
    private nick: string,
    private readonly password: string,
    private readonly hooks: SessionHooks
  ) {}

  // kick off negotiation once the socket is open
  start(): void {
    this.hooks.send('CAP LS 302')
    this.hooks.send(`NICK ${this.nick}`)
    this.hooks.send('USER badinage 0 * :Badinage')
  }

  get currentNick(): string {
    return this.nick
  }

  handle(line: IrcLine): void {
    switch (line.command) {
      case 'CAP':
        this.onCap(line)
        break
      case 'AUTHENTICATE':
        this.onAuthenticate(line)
        break
      case RPL_WELCOME:
        this.registered = true
        // the server may have forced a different nick than requested.
        // the welcome target is authoritative
        if (line.params[0]) this.nick = line.params[0]
        this.hooks.onRegistered(this.nick)
        break
      case RPL_SASLSUCCESS:
        this.hooks.send('CAP END')
        break
      case ERR_SASLFAIL:
      case ERR_SASLTOOLONG:
      case ERR_SASLABORTED:
        this.hooks.onAuthFail()
        break
      case ERR_SASLALREADY:
        this.hooks.send('CAP END')
        break
      case ERR_PASSWDMISMATCH:
        this.hooks.onAuthFail()
        break
      case ERR_ERRONEUSNICKNAME:
        this.hooks.onError(line.text)
        break
      case ERR_NICKNAMEINUSE:
        this.onNickInUse()
        break
      case 'ERROR':
        this.hooks.onError(line.text)
        break
    }
  }

  private onCap(line: IrcLine): void {
    // CAP <nick|*> <subcommand> [*] :list
    const sub = line.params[1]?.toUpperCase()
    switch (sub) {
      case 'LS': {
        for (const cap of line.text.split(/\s+/).filter(Boolean)) {
          this.offered.add(cap.split('=')[0] ?? cap)
        }
        // param 2 '*' means another LS line follows
        if (line.params[2] === '*') return
        this.lsDone = true
        const want = WANT_CAPS.filter((c) => this.offered.has(c))
        if (want.length > 0) {
          this.hooks.send(`CAP REQ :${want.join(' ')}`)
        } else {
          this.hooks.send('CAP END')
        }
        break
      }
      case 'ACK': {
        for (const cap of line.text.split(/\s+/).filter(Boolean)) {
          this.caps.add(cap.startsWith('-') ? cap.slice(1) : cap)
        }
        this.maybeStartSasl()
        break
      }
      case 'NAK':
        // refused caps stay unsupported. If none were sasl the
        // negotiation is done
        if (line.text.split(/\s+/).includes('sasl') || !this.password) {
          this.hooks.send('CAP END')
        } else {
          this.maybeStartSasl()
        }
        break
      case 'NEW': {
        // cap-notify: pick up anything interesting that appears later
        const want = line.text
          .split(/\s+/)
          .map((c) => c.split('=')[0] ?? c)
          .filter((c) => WANT_CAPS.includes(c) && !this.caps.has(c))
        if (want.length > 0) this.hooks.send(`CAP REQ :${want.join(' ')}`)
        break
      }
      case 'DEL':
        for (const cap of line.text.split(/\s+/).filter(Boolean)) this.caps.delete(cap)
        break
      case 'LIST':
        break
    }
  }

  private maybeStartSasl(): void {
    if (this.saslStarted || !this.lsDone) return
    this.saslStarted = true
    if (this.password && this.caps.has('sasl')) {
      this.hooks.send('AUTHENTICATE PLAIN')
    } else {
      this.hooks.send('CAP END')
    }
  }

  private onAuthenticate(line: IrcLine): void {
    if (line.params[0] !== '+') return
    // SASL PLAIN: authzid \0 authcid \0 passwd, base64, chunked
    const payload = btoa(`\0${this.nick}\0${this.password}`)
    for (let i = 0; i < payload.length; i += SASL_MAX_CHUNK) {
      this.hooks.send(`AUTHENTICATE ${payload.slice(i, i + SASL_MAX_CHUNK)}`)
    }
    if (payload.length % SASL_MAX_CHUNK === 0) this.hooks.send('AUTHENTICATE +')
  }

  private onNickInUse(): void {
    if (this.registered) return
    // sasl-authed sessions on ergo share nicks across clients, so 433
    // here means an unauthed collision. Retry once with a suffix, then
    // give up as an error
    if (!this.nickFallbackTried) {
      this.nickFallbackTried = true
      this.nick = `${this.nick}${NICK_FALLBACK_SUFFIX}`
      this.hooks.send(`NICK ${this.nick}`)
    } else {
      this.hooks.onError('nickname in use')
    }
  }
}

// mutable session-scoped state: joined channels for rejoin, sent
// reactions for diffing, labels for send-failure correlation. The
// maps clear when the link drops. Channels survive so reconnect can
// rejoin
export class SessionState {
  readonly channels = new Set<string>()
  readonly reacted = new Map<string, Set<string>>()
  private readonly labels = new Map<string, { peer: string; wireId: string }>()

  noteLabel(label: string, peer: string): void {
    this.labels.set(label, { peer, wireId: label })
  }

  // a labeled-response failure arrived: build the error message for
  // the send it correlated to, if any
  failLabel(
    label: string,
    text: string,
    to: string,
    emit: (message: IncomingMessage) => void,
    condition?: string
  ): void {
    const pending = this.labels.get(label)
    if (!pending) return
    this.labels.delete(label)
    emit({
      from: pending.peer,
      to,
      body: '',
      type: 'chat',
      id: pending.wireId,
      error: { ...(condition ? { condition } : {}), text }
    })
  }

  clear(): void {
    this.reacted.clear()
    this.labels.clear()
  }
}
