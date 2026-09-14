import { describe, expect, it } from 'vitest'

import { CallEngine, type CallMediaDeps } from './engine'

interface FakePc {
  added: RTCIceCandidateInit[]
  remote?: RTCSessionDescriptionInit | undefined
  closed: boolean
  onicecandidate:
    ((e: { candidate: { sdpMid: string | null; candidate: string } | null }) => void) | null
  ontrack: ((e: { streams: MediaStream[] }) => void) | null
  oniceconnectionstatechange: (() => void) | null
  iceConnectionState: string
}

function fakeTrack(kind: string) {
  return {
    kind,
    enabled: true,
    stopped: false,
    stop() {
      this.stopped = true
    }
  }
}

function fakeStream(tracks: ReturnType<typeof fakeTrack>[]) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video')
  } as unknown as MediaStream
}

function fakeDeps(tracks: ReturnType<typeof fakeTrack>[]) {
  // the engine attaches its event handlers onto the peer object itself,
  // so the inspectable fake and the peer must be the same object
  const pc = {
    added: [] as RTCIceCandidateInit[],
    remote: undefined as RTCSessionDescriptionInit | undefined,
    closed: false,
    onicecandidate: null as FakePc['onicecandidate'],
    ontrack: null as FakePc['ontrack'],
    oniceconnectionstatechange: null as FakePc['oniceconnectionstatechange'],
    iceConnectionState: 'new',
    addTrack: () => undefined,
    createOffer: async () => ({ type: 'offer' as const, sdp: 'offer-sdp' }),
    createAnswer: async () => ({ type: 'answer' as const, sdp: 'answer-sdp' }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async (d: RTCSessionDescriptionInit) => {
      pc.remote = d
    },
    addIceCandidate: async (c: RTCIceCandidateInit) => {
      pc.added.push(c)
    },
    close: () => {
      pc.closed = true
    }
  }
  const deps: CallMediaDeps = {
    peer: () => pc as unknown as RTCPeerConnection,
    media: async () => fakeStream(tracks)
  }
  return { deps, pc }
}

describe('CallEngine', () => {
  it('produces an offer sdp and wires ice events', async () => {
    const { deps, pc } = fakeDeps([fakeTrack('audio')])
    const engine = new CallEngine(deps)
    const candidates: (string | null)[] = []
    engine.onCandidate = (mid) => candidates.push(mid)
    const sdp = await engine.offer([], false)
    expect(sdp).toBe('offer-sdp')
    pc.onicecandidate?.({ candidate: { sdpMid: '0', candidate: 'candidate:x' } })
    expect(candidates).toEqual(['0'])
  })

  it('answers with the remote offer applied', async () => {
    const { deps, pc } = fakeDeps([fakeTrack('audio')])
    const engine = new CallEngine(deps)
    const sdp = await engine.answer([], 'remote-offer', false)
    expect(sdp).toBe('answer-sdp')
    expect(pc.remote?.sdp).toBe('remote-offer')
  })

  it('buffers candidates until the remote description lands', async () => {
    const { deps, pc } = fakeDeps([fakeTrack('audio')])
    const engine = new CallEngine(deps)
    engine.addCandidate('0', 'candidate:early')
    expect(pc.added).toHaveLength(0)
    await engine.answer([], 'remote-offer', false)
    expect(pc.added).toEqual([{ candidate: 'candidate:early', sdpMid: '0' }])
    engine.addCandidate('0', 'candidate:late')
    expect(pc.added).toHaveLength(2)
  })

  it('toggles audio and video tracks', async () => {
    const tracks = [fakeTrack('audio'), fakeTrack('video')]
    const { deps } = fakeDeps(tracks)
    const engine = new CallEngine(deps)
    await engine.offer([], true)
    engine.setMuted(true)
    expect(tracks[0]?.enabled).toBe(false)
    expect(tracks[1]?.enabled).toBe(true)
    engine.setCamera(false)
    expect(tracks[1]?.enabled).toBe(false)
  })

  it('stops tracks and closes the peer on close', async () => {
    const tracks = [fakeTrack('audio')]
    const { deps, pc } = fakeDeps(tracks)
    const engine = new CallEngine(deps)
    await engine.offer([], false)
    engine.close()
    expect(tracks[0]?.stopped).toBe(true)
    expect(pc.closed).toBe(true)
  })
})
