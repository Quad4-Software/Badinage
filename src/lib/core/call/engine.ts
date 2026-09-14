// WebRTC call engine: owns the RTCPeerConnection and the local media
// stream and speaks plain SDP to the jingle layer. The browser objects
// are injected so unit tests can drive the class with fakes and the
// state layer never touches DOM globals directly.

import type { IceServer } from '../xmpp/jingle/extdisco'
import { noop } from '../xmpp/features/transport'

// addIceCandidate failures are expected: stale mids, closed transports

export interface CallMediaDeps {
  peer(config: { iceServers: IceServer[] }): RTCPeerConnection
  media(constraints: { audio: boolean; video: boolean }): Promise<MediaStream>
}

export type IceConnectionState = string

export class CallEngine {
  localStream?: MediaStream | undefined
  remoteStream?: MediaStream | undefined
  // sdp line plus the mid it belongs to - the jingle side maps the mid
  // onto the content name it chose for that m-section
  onCandidate?: ((mid: string | null, line: string) => void) | undefined
  onTrack?: ((stream: MediaStream) => void) | undefined
  onIceState?: ((state: IceConnectionState) => void) | undefined

  private pc?: RTCPeerConnection | undefined
  private remoteSet = false
  private pending: { mid: string | null; line: string }[] = []

  constructor(private readonly deps: CallMediaDeps) {}

  private attach(pc: RTCPeerConnection): void {
    pc.onicecandidate = (event) => {
      if (event.candidate) this.onCandidate?.(event.candidate.sdpMid, event.candidate.candidate)
    }
    pc.ontrack = (event) => {
      const stream = event.streams[0]
      if (stream) {
        this.remoteStream = stream
        this.onTrack?.(stream)
      }
    }
    pc.oniceconnectionstatechange = () => {
      this.onIceState?.(pc.iceConnectionState)
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
        this.onIceState?.(pc.iceConnectionState)
      }
    }
  }

  private async setup(ice: IceServer[], video: boolean): Promise<RTCPeerConnection> {
    this.localStream = await this.deps.media({ audio: true, video })
    const pc = this.deps.peer({ iceServers: ice })
    this.attach(pc)
    for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream)
    this.pc = pc
    return pc
  }

  // gather offers with trickle ice: the sdp goes out immediately and
  // later candidates flow through onCandidate
  async offer(ice: IceServer[], video: boolean): Promise<string> {
    const pc = await this.setup(ice, video)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    return offer.sdp ?? ''
  }

  async answer(ice: IceServer[], remoteSdp: string, video: boolean): Promise<string> {
    const pc = await this.setup(ice, video)
    await pc.setRemoteDescription({ type: 'offer', sdp: remoteSdp })
    this.remoteSet = true
    this.flushPending()
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    return answer.sdp ?? ''
  }

  async acceptAnswer(sdp: string): Promise<void> {
    if (!this.pc) return
    await this.pc.setRemoteDescription({ type: 'answer', sdp })
    this.remoteSet = true
    this.flushPending()
  }

  // candidates that arrive before the remote description lands are
  // buffered because addIceCandidate rejects them otherwise
  addCandidate(mid: string | null, line: string): void {
    if (!this.pc || !this.remoteSet) {
      this.pending.push({ mid, line })
      return
    }
    void this.pc.addIceCandidate({ candidate: line, sdpMid: mid }).catch(noop)
  }

  private flushPending(): void {
    for (const { mid, line } of this.pending.splice(0)) {
      void this.pc?.addIceCandidate({ candidate: line, sdpMid: mid }).catch(noop)
    }
  }

  setMuted(muted: boolean): void {
    for (const track of this.localStream?.getAudioTracks() ?? []) track.enabled = !muted
  }

  setCamera(on: boolean): void {
    for (const track of this.localStream?.getVideoTracks() ?? []) track.enabled = on
  }

  close(): void {
    for (const track of this.localStream?.getTracks() ?? []) track.stop()
    this.localStream = undefined
    this.remoteStream = undefined
    this.pc?.close()
    this.pc = undefined
    this.remoteSet = false
    this.pending = []
  }
}
