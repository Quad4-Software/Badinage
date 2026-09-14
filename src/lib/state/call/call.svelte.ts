// Call session state: one active jingle call at a time. The store owns
// the JingleSession fsm and the CallEngine and exposes a plain CallView
// the ui renders. WebRTC is injected through CallMediaDeps so the store
// stays free of DOM globals and tests can drive it with fakes.

import { SvelteMap } from 'svelte/reactivity'

import { CallEngine, type CallMediaDeps } from '$lib/core/call/engine'
import { browserMediaDeps, callsSupported } from '$lib/core/call/browser'
import { JingleSession } from '$lib/core/xmpp/jingle/session'
import {
  candidateToSdpLine,
  contentsToSdp,
  sdpLineToCandidate,
  sdpToContents
} from '$lib/core/xmpp/jingle/sdp'
import { jingleIq } from '$lib/core/xmpp/jingle/stanzas'
import { servicesToIceServers, type IceServer } from '$lib/core/xmpp/jingle/extdisco'
import type { JingleContent, JinglePacket, JingleReason } from '$lib/core/xmpp/jingle/types'
import type { Account } from '../accounts.svelte'

type CallPhase = 'dialing' | 'ringing' | 'incoming' | 'connecting' | 'active' | 'ended'

interface CallView {
  accountJid: string
  // full jid of the remote party
  peer: string
  video: boolean
  phase: CallPhase
  muted: boolean
  cameraOn: boolean
  endReason?: string | undefined
}

// unanswered rings give up. The ended view lingers so the ui can show why
const RING_TIMEOUT_MS = 45_000
const END_LINGER_MS = 3_000

class CallStore {
  view = $state<CallView | null>(null)
  localStream = $state<MediaStream | null>(null)
  remoteStream = $state<MediaStream | null>(null)
  // peer jids probed for jingle support, so call buttons do not appear
  // for clients that would fail the call anyway
  capable = new SvelteMap<string, boolean>()

  private session?: JingleSession | undefined
  private engine?: CallEngine | undefined
  private account?: Account | undefined
  private offer?: JingleContent[] | undefined
  private ringTimer?: ReturnType<typeof setTimeout> | undefined
  private deps: () => CallMediaDeps = browserMediaDeps

  // tests inject fake media deps so no WebRTC stack is needed
  setMediaDeps(deps: () => CallMediaDeps): void {
    this.deps = deps
  }

  // XMPP transports expose sendJingle. Irc and demo do not and the ui
  // hides call controls when this returns false
  canCall(account: Account): boolean {
    return callsSupported() && account.connection.sendJingle !== undefined
  }

  // one disco probe per full jid, cached for the session
  probe(account: Account, fullJid: string): void {
    if (!this.canCall(account) || this.capable.has(fullJid)) return
    this.capable.set(fullJid, false)
    account.connection.jingleSupported?.(fullJid, (ok) => this.capable.set(fullJid, ok))
  }

  private ice(onDone: (servers: IceServer[]) => void): void {
    const conn = this.account?.connection
    if (!conn?.externalServices) return onDone([])
    conn.externalServices((services) => onDone(servicesToIceServers(services)))
  }

  private makeEngine(): CallEngine {
    const engine = new CallEngine(this.deps())
    engine.onCandidate = (mid, line) => {
      const candidate = sdpLineToCandidate(line)
      const session = this.session
      const conn = this.account?.connection
      if (!candidate || !session || !conn) return
      const content: JingleContent = {
        name: mid ?? '0',
        creator: session.role,
        senders: 'both',
        payloads: [],
        transport: { candidates: [candidate] }
      }
      conn.sendJingle?.(session.transportInfoStanza(conn, [content]))
    }
    engine.onTrack = (stream) => {
      this.remoteStream = stream
      if (this.view) this.view.phase = 'active'
    }
    engine.onIceState = (state) => {
      if (state === 'failed') return this.end('connectivity-error')
      if ((state === 'connected' || state === 'completed') && this.view?.phase === 'connecting') {
        this.view.phase = 'active'
      }
    }
    this.engine = engine
    return engine
  }

  private cleanup(reason?: string): void {
    clearTimeout(this.ringTimer)
    this.ringTimer = undefined
    this.engine?.close()
    this.engine = undefined
    this.session = undefined
    this.account = undefined
    this.offer = undefined
    this.localStream = null
    this.remoteStream = null
    if (this.view) {
      this.view.phase = 'ended'
      this.view.endReason = reason
      setTimeout(() => {
        if (this.view?.phase === 'ended') this.view = null
      }, END_LINGER_MS)
    }
  }

  private end(reason: JingleReason): void {
    const session = this.session
    const conn = this.account?.connection
    if (session && conn && session.state !== 'ended') {
      conn.sendJingle?.(session.terminateStanza(conn, reason))
    }
    this.cleanup(reason === 'success' ? undefined : reason)
  }

  private terminateGhost(account: Account, packet: JinglePacket, reason: JingleReason): void {
    const conn = account.connection
    const action = 'session-terminate'
    conn.sendJingle?.(
      jingleIq(conn, packet.from, { action, sid: packet.sid, contents: [], reason })
    )
  }

  private freshView(account: Account, peer: string, video: boolean, phase: CallPhase): CallView {
    return { accountJid: account.jid, peer, video, phase, muted: false, cameraOn: video }
  }

  async start(account: Account, peerFullJid: string, video: boolean): Promise<void> {
    if (this.view || !this.canCall(account) || !peerFullJid.includes('/')) return
    this.account = account
    this.view = this.freshView(account, peerFullJid, video, 'dialing')
    this.ice(async (servers) => {
      try {
        const engine = this.makeEngine()
        const sdp = await engine.offer(servers, video)
        // getUserMedia can outlive a hangup. Bail if state moved on
        if (this.view?.phase !== 'dialing' || this.account !== account) {
          engine.close()
          return
        }
        const session = new JingleSession(
          account.connection.uniqueId('sid'),
          peerFullJid,
          'initiator',
          account.connection.jid
        )
        this.session = session
        this.localStream = engine.localStream ?? null
        const stanza = session.initiateStanza(account.connection, sdpToContents(sdp, 'initiator'))
        account.connection.sendJingle?.(stanza, (ok) => {
          if (!ok) this.cleanup('failed-application')
        })
        this.ringTimer = setTimeout(() => this.end('timeout'), RING_TIMEOUT_MS)
      } catch {
        this.cleanup('media-error')
      }
    })
  }

  async accept(): Promise<void> {
    const session = this.session
    const offer = this.offer
    const view = this.view
    const account = this.account
    if (!session || !offer || !view || !account || view.phase !== 'incoming') return
    view.phase = 'connecting'
    this.ice(async (servers) => {
      try {
        const engine = this.makeEngine()
        const sdp = await engine.answer(servers, contentsToSdp(offer, 'offer'), view.video)
        if (this.session !== session || this.view !== view) {
          engine.close()
          return
        }
        this.localStream = engine.localStream ?? null
        const stanza = session.acceptStanza(account.connection, sdpToContents(sdp, 'responder'))
        account.connection.sendJingle?.(stanza, (ok) => {
          if (!ok) this.cleanup('failed-application')
        })
      } catch {
        this.end('media-error')
      }
    })
  }

  decline(): void {
    this.end('decline')
  }

  hangup(): void {
    this.end('success')
  }

  toggleMute(): void {
    if (!this.view) return
    this.view.muted = !this.view.muted
    this.engine?.setMuted(this.view.muted)
  }

  toggleCamera(): void {
    if (!this.view) return
    this.view.cameraOn = !this.view.cameraOn
    this.engine?.setCamera(this.view.cameraOn)
  }

  // entry point for the account event wiring: every inbound jingle iq
  // lands here
  notePacket(account: Account, packet: JinglePacket): void {
    if (packet.action === 'session-initiate' && packet.sid !== this.session?.sid) {
      if (this.view) {
        // reply on the receiving account, not the live call's account
        this.terminateGhost(account, packet, 'busy')
        return
      }
      this.account = account
      const session = JingleSession.fromInitiate(packet, account.connection.jid)
      if (!session) return
      this.session = session
      this.offer = packet.contents
      const video = packet.contents.some((c) => c.media === 'video')
      this.view = this.freshView(account, packet.from, video, 'incoming')
      return
    }
    if (!this.session) {
      // session-less packets get an unknown-session terminate so the
      // peer does not keep a ghost alive
      if (packet.action !== 'session-terminate') {
        this.terminateGhost(account, packet, 'unknown-session')
      }
      return
    }
    this.route(this.session.apply(packet))
  }

  private route(result: ReturnType<JingleSession['apply']>): void {
    switch (result.kind) {
      case 'answer': {
        clearTimeout(this.ringTimer)
        this.ringTimer = undefined
        if (this.view) this.view.phase = 'connecting'
        void this.engine?.acceptAnswer(contentsToSdp(result.contents, 'answer')).catch(() => {
          this.end('failed-application')
        })
        break
      }
      case 'terminated':
        this.cleanup(result.reason === 'success' ? undefined : result.reason)
        break
      case 'ringing':
        if (this.view?.phase === 'dialing') this.view.phase = 'ringing'
        break
      case 'candidates':
        for (const [name, cands] of result.byContent) {
          for (const c of cands) this.engine?.addCandidate(name, candidateToSdpLine(c))
        }
        break
      case 'invalid':
        this.end('general-error')
        break
      default:
        break
    }
  }

  // account teardown drops any live call on that account
  releaseAccount(jid: string): void {
    if (this.view?.accountJid === jid) this.end('success')
  }

  // drop session state synchronously, no linger (test hook)
  reset(): void {
    this.cleanup()
    this.view = null
  }
}

export const calls = new CallStore()
