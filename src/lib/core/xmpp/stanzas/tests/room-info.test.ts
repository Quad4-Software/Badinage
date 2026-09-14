import { describe, expect, it } from 'vitest'

import { NS } from '../../ns'
import { grantMembership, parseRoomInfo } from '../../features/muc'
import type { DiscoInfo } from '../types'
import type { StanzaBuilder, XmppTransport } from '../../features/transport'

function info(features: string[], fields: Record<string, string> = {}): DiscoInfo {
  return {
    identities: [{ category: 'conference', type: 'text' }],
    features,
    forms:
      Object.keys(fields).length === 0
        ? []
        : [
            {
              formType: 'http://jabber.org/protocol/muc#roominfo',
              fields: Object.entries(fields).map(([k, v]) => ({ var: k, values: [v] }))
            }
          ]
  }
}

describe('parseRoomInfo', () => {
  it('returns undefined when the probe failed', () => {
    expect(parseRoomInfo(null)).toBeUndefined()
  })

  it('maps a members-only non-anonymous occupant-id room', () => {
    const room = parseRoomInfo(
      info(['muc_membersonly', 'muc_nonanonymous', NS.OCCUPANT_ID], {
        'muc#roominfo_changesubject': '0'
      })
    )
    expect(room).toEqual({
      membersOnly: true,
      anonymous: false,
      occupantIds: true,
      changeSubject: false
    })
  })

  it('treats semianonymous and fullyanonymous as anonymous', () => {
    expect(parseRoomInfo(info(['muc_semianonymous']))?.anonymous).toBe(true)
    expect(parseRoomInfo(info(['muc_fullyanonymous']))?.anonymous).toBe(true)
    expect(parseRoomInfo(info(['muc_nonanonymous']))?.anonymous).toBe(false)
  })

  it('defaults changeSubject to true when the form is silent', () => {
    expect(parseRoomInfo(info(['muc_open']))?.changeSubject).toBe(true)
    expect(parseRoomInfo(info([], { 'muc#roominfo_changesubject': '1' }))?.changeSubject).toBe(true)
    expect(parseRoomInfo(info([], { 'muc#roominfo_changesubject': 'false' }))?.changeSubject).toBe(
      false
    )
  })

  it('leaves an open room open and anonymous', () => {
    const room = parseRoomInfo(info(['muc_open', 'muc_semianonymous']))
    expect(room?.membersOnly).toBe(false)
    expect(room?.anonymous).toBe(true)
  })
})

describe('grantMembership', () => {
  it('sends a muc#admin affiliation set on the bare jid', () => {
    const iqs: StanzaBuilder[] = []
    const conn: XmppTransport = {
      sendIq: (stanza) => iqs.push(stanza),
      send: () => undefined,
      uniqueId: (p) => `${p}-1`,
      jid: 'me@x/res'
    }
    grantMembership(conn, 'room@muc.x', 'invitee@x.y/res')
    const xml = String(iqs[0])
    expect(xml).toContain('type="set"')
    expect(xml).toContain('to="room@muc.x"')
    expect(xml).toContain(NS.MUC_ADMIN)
    expect(xml).toContain('affiliation="member"')
    expect(xml).toContain('jid="invitee@x.y"')
    expect(xml).not.toContain('/res')
  })
})
