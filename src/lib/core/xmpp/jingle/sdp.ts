// SDP to jingle content translation in both directions. The local
// WebRTC side only speaks SDP while the wire speaks jingle content
// elements, so every offer and answer crosses this module twice.
//
// Scope: audio and video m-sections with rtpmap and fmtp, one bundled
// ice-udp transport, dtls fingerprint and trickle candidates. Data
// channels, sctp and extmap attributes are dropped on purpose.

import type { JingleCandidate, JingleContent, JingleSender } from './types'

interface MLine {
  media: 'audio' | 'video'
  payloads: string[]
  mid: string
  direction: string
  ufrag?: string | undefined
  pwd?: string | undefined
  fingerprint?: { hash: string; value: string } | undefined
  setup?: string | undefined
  rtpmap: Map<string, { name: string; clockrate: string; channels?: string | undefined }>
  fmtp: Map<string, string>
  candidates: JingleCandidate[]
}

function attrValue(line: string): string {
  const idx = line.indexOf(':')
  return idx < 0 ? '' : line.slice(idx + 1)
}

// candidate lines arrive either bare (candidate:...) or prefixed
// (a=candidate:...) and jingle needs the attribute form exploded
export function sdpLineToCandidate(line: string): JingleCandidate | null {
  const body = line.startsWith('a=') ? line.slice(2) : line
  const parts = (body.startsWith('candidate:') ? body.slice(10) : body).split(/\s+/)
  // foundation component protocol priority ip port typ type [raddr x rport y]
  if (parts.length < 8 || parts[6] !== 'typ') return null
  const cand: JingleCandidate = {
    foundation: parts[0] ?? '',
    component: parts[1] ?? '',
    protocol: parts[2] ?? '',
    priority: parts[3] ?? '',
    ip: parts[4] ?? '',
    port: parts[5] ?? '',
    type: parts[7] ?? '',
    generation: '0',
    network: '0'
  }
  for (let i = 8; i + 1 < parts.length; i += 2) {
    if (parts[i] === 'raddr') cand.relAddr = parts[i + 1]
    if (parts[i] === 'rport') cand.relPort = parts[i + 1]
    if (parts[i] === 'generation') cand.generation = parts[i + 1] ?? '0'
    if (parts[i] === 'network-id') cand.network = parts[i + 1] ?? '0'
  }
  return cand
}

export function candidateToSdpLine(c: JingleCandidate): string {
  let line = `candidate:${c.foundation} ${c.component} ${c.protocol} ${c.priority} ${c.ip} ${c.port} typ ${c.type}`
  if (c.relAddr) line += ` raddr ${c.relAddr} rport ${c.relPort ?? '0'}`
  line += ` generation ${c.generation} network-id ${c.network}`
  return line
}

function parseFingerprint(line: string): { hash: string; value: string } | undefined {
  // a=fingerprint:sha-256 AA:BB:... - the sibling a=setup attribute is
  // parsed separately since the two are order independent
  const parts = attrValue(line).split(' ')
  if (parts.length < 2) return undefined
  return { hash: parts[0] ?? '', value: parts.slice(1).join(' ') }
}

function mergeFingerprint(
  fp: { hash: string; value: string } | undefined,
  setup: string | undefined
): JingleContent['transport']['fingerprint'] {
  if (!fp) return undefined
  return { hash: fp.hash, setup: setup ?? 'actpass', value: fp.value }
}

// splits an sdp blob into the shared session attributes and the media
// sections jingle maps onto contents
export function sdpToContents(sdp: string, creator: 'initiator' | 'responder'): JingleContent[] {
  const lines = sdp.split(/\r?\n/)
  let sessionUfrag: string | undefined
  let sessionPwd: string | undefined
  let sessionFingerprint: { hash: string; value: string } | undefined
  let sessionSetup: string | undefined
  const mlines: MLine[] = []
  let current: MLine | undefined

  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('m=')) {
      const head = line.slice(2).split(/\s+/)
      const media = head[0] === 'video' ? 'video' : 'audio'
      const payloads = head.slice(3)
      current = {
        media,
        payloads,
        mid: String(mlines.length),
        direction: 'sendrecv',
        rtpmap: new Map(),
        fmtp: new Map(),
        candidates: []
      }
      mlines.push(current)
      continue
    }
    if (!line.startsWith('a=')) continue
    // direction attributes (a=sendrecv) carry no colon. Everything else
    // is name:value. slice(2, -1) on a colon-less line eats the last char
    const colon = line.indexOf(':')
    const name = colon < 0 ? line.slice(2) : line.slice(2, colon)
    if (!current) {
      // session-level attributes shared by every m-section
      if (name === 'ice-ufrag') sessionUfrag = attrValue(line)
      if (name === 'ice-pwd') sessionPwd = attrValue(line)
      if (name === 'fingerprint') sessionFingerprint = parseFingerprint(line)
      if (name === 'setup') sessionSetup = attrValue(line)
      continue
    }
    if (name === 'mid') current.mid = attrValue(line)
    else if (name === 'ice-ufrag') current.ufrag = attrValue(line)
    else if (name === 'ice-pwd') current.pwd = attrValue(line)
    else if (name === 'fingerprint') current.fingerprint = parseFingerprint(line)
    else if (name === 'setup') current.setup = attrValue(line)
    else if (name === 'candidate') {
      const cand = sdpLineToCandidate(line)
      if (cand) current.candidates.push(cand)
    } else if (name === 'rtpmap') {
      const [id = '', codec = ''] = attrValue(line).split(' ')
      const [cname = '', clock = '', chans] = codec.split('/')
      current.rtpmap.set(id, { name: cname, clockrate: clock, channels: chans || undefined })
    } else if (name === 'fmtp') {
      const [id = '', ...rest] = attrValue(line).split(' ')
      current.fmtp.set(id, rest.join(' '))
    } else if (['sendrecv', 'sendonly', 'recvonly', 'inactive'].includes(name)) {
      current.direction = name
    }
  }

  const senders: Record<string, JingleSender> = {
    sendrecv: 'both',
    sendonly: creator,
    recvonly: creator === 'initiator' ? 'responder' : 'initiator',
    inactive: 'none'
  }

  return mlines.map((m) => ({
    name: m.mid,
    media: m.media,
    creator,
    senders: senders[m.direction] ?? 'both',
    payloads: m.payloads
      .filter((pt) => m.rtpmap.has(pt))
      .map((pt) => {
        const codec = m.rtpmap.get(pt)
        const payload: JingleContent['payloads'][number] = {
          id: pt,
          name: codec?.name ?? '',
          clockrate: codec?.clockrate ?? ''
        }
        if (codec?.channels) payload.channels = codec.channels
        const params = m.fmtp.get(pt)
        if (params) payload.params = params
        return payload
      }),
    transport: {
      ufrag: m.ufrag ?? sessionUfrag,
      pwd: m.pwd ?? sessionPwd,
      fingerprint: mergeFingerprint(m.fingerprint ?? sessionFingerprint, m.setup ?? sessionSetup),
      candidates: m.candidates
    }
  }))
}

// remote jingle contents become a synthetic sdp the browser accepts.
// Directions are written from the remote side's perspective: what the
// peer offered is what our setRemoteDescription must repeat back
export function contentsToSdp(contents: JingleContent[], role: 'offer' | 'answer'): string {
  const directions: Record<string, string> = {
    both: 'sendrecv',
    initiator: 'sendonly',
    responder: 'recvonly',
    none: 'inactive'
  }
  const mids = contents.map((c) => c.name)
  const out: string[] = [
    'v=0',
    'o=- 0 0 IN IP4 0.0.0.0',
    's=-',
    't=0 0',
    `a=group:BUNDLE ${mids.join(' ')}`,
    'a=msid-semantic: WMS'
  ]
  for (const content of contents) {
    const pts = content.payloads.map((p) => p.id).join(' ')
    const t = content.transport
    out.push(`m=${content.media} 9 UDP/TLS/RTP/SAVPF ${pts}`)
    out.push('c=IN IP4 0.0.0.0')
    out.push('a=rtcp:9 IN IP4 0.0.0.0')
    if (t.ufrag) out.push(`a=ice-ufrag:${t.ufrag}`)
    if (t.pwd) out.push(`a=ice-pwd:${t.pwd}`)
    out.push('a=ice-options:trickle')
    if (t.fingerprint) out.push(`a=fingerprint:${t.fingerprint.hash} ${t.fingerprint.value}`)
    out.push(`a=setup:${role === 'offer' ? 'actpass' : 'active'}`)
    out.push(`a=mid:${content.name}`)
    out.push(`a=${directions[content.senders] ?? 'sendrecv'}`)
    out.push('a=rtcp-mux')
    for (const p of content.payloads) {
      out.push(`a=rtpmap:${p.id} ${p.name}/${p.clockrate}${p.channels ? `/${p.channels}` : ''}`)
      if (p.params) out.push(`a=fmtp:${p.id} ${p.params}`)
    }
    for (const c of t.candidates) out.push(`a=${candidateToSdpLine(c)}`)
  }
  return out.join('\r\n') + '\r\n'
}
