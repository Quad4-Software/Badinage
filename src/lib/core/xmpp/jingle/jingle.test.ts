import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'

import { candidateToSdpLine, contentsToSdp, sdpLineToCandidate, sdpToContents } from './sdp'
import { jingleIq, parseJingle } from './stanzas'
import type { JingleContent } from './types'

const parser = new DOMParser()

function xml(markup: string): Element {
  const doc = parser.parseFromString(markup, 'application/xml').documentElement
  if (!doc) throw new Error('bad test xml')
  return doc as unknown as Element
}

const ids = { uniqueId: (prefix: string) => `${prefix}-1` }

const OFFER_SDP = [
  'v=0',
  'o=- 1234 5678 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1',
  'a=msid-semantic: WMS',
  'a=ice-ufrag:abcd',
  'a=ice-pwd:longpasswordhere',
  'a=fingerprint:sha-256 AA:BB:CC:DD',
  'a=setup:actpass',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 0',
  'c=IN IP4 0.0.0.0',
  'a=mid:0',
  'a=sendrecv',
  'a=rtcp-mux',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:0 PCMU/8000',
  'a=candidate:1 1 udp 2130706431 192.168.1.2 54321 typ host',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'c=IN IP4 0.0.0.0',
  'a=mid:1',
  'a=sendrecv',
  'a=rtcp-mux',
  'a=rtpmap:96 VP8/90000',
  ''
].join('\r\n')

describe('sdpLineToCandidate', () => {
  it('parses host candidates with and without the a= prefix', () => {
    const bare = sdpLineToCandidate('candidate:1 1 udp 211 10.0.0.1 9999 typ host')
    const prefixed = sdpLineToCandidate('a=candidate:1 1 udp 211 10.0.0.1 9999 typ host')
    expect(bare?.ip).toBe('10.0.0.1')
    expect(prefixed).toEqual(bare)
  })

  it('captures related address for srflx candidates', () => {
    const c = sdpLineToCandidate(
      'candidate:2 1 udp 169 1.2.3.4 4000 typ srflx raddr 10.0.0.1 rport 9999'
    )
    expect(c?.type).toBe('srflx')
    expect(c?.relAddr).toBe('10.0.0.1')
    expect(c?.relPort).toBe('9999')
  })

  it('rejects malformed lines', () => {
    expect(sdpLineToCandidate('candidate:1 1 udp')).toBeNull()
    expect(sdpLineToCandidate('a=mid:0')).toBeNull()
  })

  it('roundtrips through candidateToSdpLine', () => {
    const line = 'candidate:1 1 udp 211 10.0.0.1 9999 typ host'
    const c = sdpLineToCandidate(line)
    if (!c) throw new Error('expected a parsed candidate')
    const back = sdpLineToCandidate(candidateToSdpLine(c))
    expect(back).toEqual(c)
  })
})

describe('sdpToContents', () => {
  it('maps m-sections to jingle contents', () => {
    const contents = sdpToContents(OFFER_SDP, 'initiator')
    expect(contents).toHaveLength(2)
    const audio = contents[0]
    expect(audio?.media).toBe('audio')
    expect(audio?.name).toBe('0')
    expect(audio?.senders).toBe('both')
    expect(audio?.transport.ufrag).toBe('abcd')
    expect(audio?.transport.fingerprint?.value).toBe('AA:BB:CC:DD')
    expect(audio?.transport.candidates).toHaveLength(1)
    const opus = audio?.payloads.find((p) => p.id === '111')
    expect(opus?.name).toBe('opus')
    expect(opus?.channels).toBe('2')
    expect(opus?.params).toBe('minptime=10;useinbandfec=1')
    expect(contents[1]?.media).toBe('video')
    // the video m-section inherits the session-level ice credentials
    expect(contents[1]?.transport.ufrag).toBe('abcd')
  })

  it('translates sendonly into a directed senders value', () => {
    const sdp = OFFER_SDP.replace(/a=sendrecv/g, 'a=sendonly')
    const contents = sdpToContents(sdp, 'initiator')
    expect(contents[0]?.senders).toBe('initiator')
  })
})

describe('contentsToSdp', () => {
  const contents = sdpToContents(OFFER_SDP, 'initiator')

  it('produces sdp the browser can apply as a remote description', () => {
    const sdp = contentsToSdp(contents, 'offer')
    expect(sdp).toContain('m=audio 9 UDP/TLS/RTP/SAVPF 111 0')
    expect(sdp).toContain('m=video 9 UDP/TLS/RTP/SAVPF 96')
    expect(sdp).toContain('a=ice-ufrag:abcd')
    expect(sdp).toContain('a=ice-pwd:longpasswordhere')
    expect(sdp).toContain('a=fingerprint:sha-256 AA:BB:CC:DD')
    expect(sdp).toContain('a=mid:0')
    expect(sdp).toContain('a=rtpmap:111 opus/48000/2')
    expect(sdp).toContain('a=fmtp:111 minptime=10;useinbandfec=1')
    expect(sdp).toContain('a=candidate:1 1 udp 2130706431 192.168.1.2 54321 typ host')
  })

  it('roundtrips contents back through sdpToContents', () => {
    const back = sdpToContents(contentsToSdp(contents, 'offer'), 'initiator')
    expect(back[0]?.payloads.map((p) => p.id)).toEqual(contents[0]?.payloads.map((p) => p.id))
    expect(back[0]?.transport.candidates).toHaveLength(1)
  })
})

describe('parseJingle', () => {
  it('parses a session-initiate with rtp contents', () => {
    const packet = parseJingle(
      xml(`<iq type="set" from="peer@x.test/phone" to="me@x.test/web">
        <jingle xmlns="urn:xmpp:jingle:1" action="session-initiate" sid="s1" initiator="peer@x.test/phone">
          <content creator="initiator" name="0" senders="both">
            <description xmlns="urn:xmpp:jingle:apps:rtp:1" media="audio">
              <payload-type id="111" name="opus" clockrate="48000" channels="2">
                <parameter name="useinbandfec" value="1"/>
              </payload-type>
            </description>
            <transport xmlns="urn:xmpp:jingle:transports:ice-udp:1" ufrag="u" pwd="p">
              <fingerprint xmlns="urn:xmpp:jingle:apps:dtls:0" hash="sha-256" setup="actpass">AB:CD</fingerprint>
              <candidate foundation="1" component="1" protocol="udp" priority="211" ip="10.0.0.1" port="9999" type="host"/>
            </transport>
          </content>
        </jingle>
      </iq>`)
    )
    expect(packet?.action).toBe('session-initiate')
    expect(packet?.sid).toBe('s1')
    expect(packet?.from).toBe('peer@x.test/phone')
    expect(packet?.initiator).toBe('peer@x.test/phone')
    const content = packet?.contents[0]
    expect(content?.media).toBe('audio')
    expect(content?.payloads[0]?.params).toBe('useinbandfec=1')
    expect(content?.transport.ufrag).toBe('u')
    expect(content?.transport.fingerprint?.value).toBe('AB:CD')
    expect(content?.transport.candidates[0]?.ip).toBe('10.0.0.1')
  })

  it('parses terminate reasons and session-info children', () => {
    const term = parseJingle(
      xml(`<iq type="set" from="p@x/y"><jingle xmlns="urn:xmpp:jingle:1" action="session-terminate" sid="s">
        <reason><busy/></reason>
      </jingle></iq>`)
    )
    expect(term?.reason).toBe('busy')
    const ringing = parseJingle(
      xml(`<iq type="set" from="p@x/y"><jingle xmlns="urn:xmpp:jingle:1" action="session-info" sid="s">
        <ringing xmlns="urn:xmpp:jingle:apps:rtp:info:1"/>
      </jingle></iq>`)
    )
    expect(ringing?.info).toBe('ringing')
  })

  it('rejects stanzas without a jingle payload or sid', () => {
    expect(parseJingle(xml(`<iq type="set"><other xmlns="urn:x"/></iq>`))).toBeNull()
    expect(
      parseJingle(xml(`<iq type="set"><jingle xmlns="urn:xmpp:jingle:1" action="x"/></iq>`))
    ).toBeNull()
  })
})

describe('jingleIq', () => {
  it('builds stanzas that parse back to the same packet', () => {
    const contents: JingleContent[] = [
      {
        name: '0',
        media: 'audio',
        creator: 'initiator',
        senders: 'both',
        payloads: [{ id: '111', name: 'opus', clockrate: '48000', channels: '2' }],
        transport: { ufrag: 'u', pwd: 'p', candidates: [] }
      }
    ]
    const built = jingleIq(ids, 'peer@x.test/phone', {
      action: 'session-initiate',
      sid: 's1',
      initiator: 'me@x.test/web',
      contents
    })
    const parsed = parseJingle(xml(built.toString()))
    expect(parsed?.action).toBe('session-initiate')
    expect(parsed?.initiator).toBe('me@x.test/web')
    expect(parsed?.contents[0]?.payloads[0]?.name).toBe('opus')
    expect(parsed?.contents[0]?.transport.ufrag).toBe('u')
  })

  it('writes trickle contents without a description element', () => {
    const built = jingleIq(ids, 'peer@x.test/phone', {
      action: 'transport-info',
      sid: 's1',
      contents: [
        {
          name: '0',
          creator: 'initiator',
          senders: 'both',
          payloads: [],
          transport: {
            candidates: [
              {
                foundation: '1',
                component: '1',
                protocol: 'udp',
                priority: '211',
                ip: '10.0.0.1',
                port: '9999',
                type: 'host',
                generation: '0',
                network: '0'
              }
            ]
          }
        }
      ]
    })
    const parsed = parseJingle(xml(built.toString()))
    expect(parsed?.contents[0]?.transport.candidates[0]?.ip).toBe('10.0.0.1')
    expect(built.toString()).not.toContain('description')
  })
})
