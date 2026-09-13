import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'

import {
  hasDiscoFeature,
  parseBlockPush,
  parseDataForm,
  parseDiscoInfo,
  parseDiscoItems,
  parseJidItems,
  parseMamFin,
  parseRosterItems,
  parseUploadSlot,
  parseVcard,
  parseVcardPhoto
} from '..'

const parser = new DOMParser()

function xml(markup: string): Element {
  const doc = parser.parseFromString(markup, 'application/xml').documentElement
  if (!doc) throw new Error('bad test xml')
  // xmldom's Element type is structural enough for the parser functions
  return doc as unknown as Element
}
describe('parseRosterItems', () => {
  it('parses items with groups', () => {
    const items = parseRosterItems(
      xml(`<iq type="result"><query xmlns="jabber:iq:roster">
        <item jid="a@b.c" name="A" subscription="both"><group>Friends</group></item>
        <item jid="x@y.z" subscription="remove"/>
      </query></iq>`)
    )
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ jid: 'a@b.c', name: 'A', subscription: 'both' })
    expect(items[0]?.groups).toEqual(['Friends'])
    expect(items[1]?.subscription).toBe('remove')
  })
})

describe('parseJidItems', () => {
  it('collects jids from a block push', () => {
    const block = xml(`<block xmlns="urn:xmpp:blocking">
      <item jid="spam@a.b"/>
      <item jid="junk@c.d/phone"/>
    </block>`)
    expect(parseJidItems(block)).toEqual(['spam@a.b', 'junk@c.d/phone'])
  })

  it('collects jids from a blocklist result', () => {
    const list = xml(`<blocklist xmlns="urn:xmpp:blocking"><item jid="a@b.c"/></blocklist>`)
    expect(parseJidItems(list)).toEqual(['a@b.c'])
  })

  it('returns an empty list for an item-less unblock', () => {
    expect(parseJidItems(xml(`<unblock xmlns="urn:xmpp:blocking"/>`))).toEqual([])
  })
})

describe('parseBlockPush', () => {
  it('separates blocked and unblocked jids in one push', () => {
    const push = parseBlockPush(
      xml(`<iq type="set"><block xmlns="urn:xmpp:blocking"><item jid="spam@a.b"/></block>
        <unblock xmlns="urn:xmpp:blocking"><item jid="ok@c.d"/></unblock></iq>`)
    )
    expect(push.blocked).toEqual(['spam@a.b'])
    expect(push.unblocked).toEqual(['ok@c.d'])
  })

  it('leaves fields undefined when the push lacks the element', () => {
    const push = parseBlockPush(
      xml(`<iq type="set"><block xmlns="urn:xmpp:blocking"><item jid="spam@a.b"/></block></iq>`)
    )
    expect(push.blocked).toEqual(['spam@a.b'])
    expect(push.unblocked).toBeUndefined()
  })
})

describe('parseDiscoItems', () => {
  it('collects items with jid, node and name', () => {
    const items = parseDiscoItems(
      xml(`<iq type="result"><query xmlns="http://jabber.org/protocol/disco#items">
        <item jid="upload.example.net" name="Uploads"/>
        <item jid="proxy.example.net" node="proxynode"/>
        <item/>
      </query></iq>`)
    )
    expect(items).toEqual([
      { jid: 'upload.example.net', name: 'Uploads', node: undefined },
      { jid: 'proxy.example.net', name: undefined, node: 'proxynode' }
    ])
  })
})

describe('parseDiscoInfo', () => {
  it('reads identities, features and extension forms', () => {
    const info = parseDiscoInfo(
      xml(`<iq type="result"><query xmlns="http://jabber.org/protocol/disco#info">
        <identity category="client" type="pc" name="Exodus 0.9.1"/>
        <feature var="http://jabber.org/protocol/muc"/>
        <feature var="http://jabber.org/protocol/caps"/>
        <x xmlns="jabber:x:data" type="result">
          <field var="FORM_TYPE" type="hidden">
            <value>urn:xmpp:dataforms:softwareinfo</value>
          </field>
          <field var="software"><value>Exodus</value></field>
          <field var="ip_version"><value>ipv4</value><value>ipv6</value></field>
        </x>
      </query></iq>`)
    )
    expect(info.identities).toEqual([
      { category: 'client', type: 'pc', name: 'Exodus 0.9.1', lang: undefined }
    ])
    expect(info.features).toContain('http://jabber.org/protocol/muc')
    expect(info.forms).toEqual([
      {
        formType: 'urn:xmpp:dataforms:softwareinfo',
        fields: [
          { var: 'software', values: ['Exodus'] },
          { var: 'ip_version', values: ['ipv4', 'ipv6'] }
        ]
      }
    ])
  })

  it('skips submit-type forms and tolerates empty results', () => {
    const info = parseDiscoInfo(
      xml(`<iq type="result"><query xmlns="http://jabber.org/protocol/disco#info">
        <x xmlns="jabber:x:data" type="submit"><field var="FORM_TYPE"><value>x</value></field></x>
      </query></iq>`)
    )
    expect(info).toEqual({ identities: [], features: [], forms: [] })
  })
})

describe('hasDiscoFeature', () => {
  it('finds the advertised feature var', () => {
    const stanza = xml(`<iq type="result"><query xmlns="http://jabber.org/protocol/disco#info">
      <feature var="urn:xmpp:http:upload:0"/>
    </query></iq>`)
    expect(hasDiscoFeature(stanza, 'urn:xmpp:http:upload:0')).toBe(true)
    expect(hasDiscoFeature(stanza, 'jabber:iq:roster')).toBe(false)
  })
})

describe('parseUploadSlot', () => {
  it('reads urls from attributes', () => {
    const slot = parseUploadSlot(
      xml(`<iq type="result"><slot xmlns="urn:xmpp:http:upload:0">
        <put url="https://up.example.net/put"/><get url="https://up.example.net/get"/>
      </slot></iq>`)
    )
    expect(slot).toEqual({
      putUrl: 'https://up.example.net/put',
      getUrl: 'https://up.example.net/get'
    })
  })

  it('reads urls from text content', () => {
    const slot = parseUploadSlot(
      xml(`<iq type="result"><slot xmlns="urn:xmpp:http:upload:0">
        <put>https://up.example.net/put</put><get>https://up.example.net/get</get>
      </slot></iq>`)
    )
    expect(slot).toEqual({
      putUrl: 'https://up.example.net/put',
      getUrl: 'https://up.example.net/get'
    })
  })

  it('returns null when a url is missing', () => {
    const slot = parseUploadSlot(
      xml(`<iq type="result"><slot xmlns="urn:xmpp:http:upload:0">
        <put url="https://up.example.net/put"/>
      </slot></iq>`)
    )
    expect(slot).toBeNull()
  })
})

describe('parseVcardPhoto', () => {
  it('builds a data uri from TYPE and BINVAL', () => {
    const uri = parseVcardPhoto(
      xml(`<iq type="result"><vCard xmlns="vcard-temp"><PHOTO>
        <TYPE>image/png</TYPE><BINVAL>aGk=</BINVAL>
      </PHOTO></vCard></iq>`)
    )
    expect(uri).toBe('data:image/png;base64,aGk=')
  })

  it('returns undefined without a photo', () => {
    const stanza = xml(`<iq type="result"><vCard xmlns="vcard-temp"/></iq>`)
    expect(parseVcardPhoto(stanza)).toBeUndefined()
  })

  it('drops non-image media types so text/html never becomes a data uri', () => {
    for (const type of ['text/html', 'application/xhtml+xml', 'image', 'text/plain']) {
      const uri = parseVcardPhoto(
        xml(`<iq type="result"><vCard xmlns="vcard-temp"><PHOTO>
          <TYPE>${type}</TYPE><BINVAL>PHNjcmlwdD4=</BINVAL>
        </PHOTO></vCard></iq>`)
      )
      expect(uri).toBeUndefined()
    }
  })
})

describe('parseVcard', () => {
  it('parses the managed fields and the photo', () => {
    const card = `<iq type="result"><vCard xmlns="vcard-temp"><FN>Alice A</FN><NICKNAME>ali</NICKNAME><DESC>hi there</DESC><PHOTO><TYPE>image/png</TYPE><BINVAL>aGk=</BINVAL></PHOTO></vCard></iq>`
    expect(parseVcard(xml(card))).toMatchObject({
      fn: 'Alice A',
      nickname: 'ali',
      desc: 'hi there',
      photoUri: 'data:image/png;base64,aGk='
    })
  })

  it('returns empty fields when the stanza carries no card', () => {
    expect(parseVcard(xml(`<iq type="result"/>`))).toEqual({
      fn: '',
      nickname: '',
      desc: '',
      photoUri: undefined
    })
  })
})

describe('parseMamFin', () => {
  it('extracts the rsm cursor', () => {
    const fin = parseMamFin(
      xml(`<iq type="result"><fin xmlns="urn:xmpp:mam:2" complete="false">
        <set xmlns="http://jabber.org/protocol/rsm">
          <first>uid-1</first><last>uid-9</last><count>9</count>
        </set>
      </fin></iq>`)
    )
    expect(fin).toEqual({ complete: false, first: 'uid-1', last: 'uid-9' })
  })

  it('reports a complete archive without a cursor', () => {
    const fin = parseMamFin(
      xml(`<iq type="result"><fin xmlns="urn:xmpp:mam:2" complete="true"/></iq>`)
    )
    expect(fin.complete).toBe(true)
    expect(fin.first).toBeUndefined()
    expect(fin.last).toBeUndefined()
  })
})

describe('parseDataForm', () => {
  it('parses a room config form generically', () => {
    const form = parseDataForm(
      xml(`<iq type="result" to="me@x.y" from="room@conference.x.y">
        <query xmlns="http://jabber.org/protocol/muc#owner">
          <x xmlns="jabber:x:data" type="form">
            <title>Config</title>
            <instructions>Fill it in</instructions>
            <field var="FORM_TYPE" type="hidden"><value>http://jabber.org/protocol/muc#roomconfig</value></field>
            <field var="muc#roomconfig_persistentroom" type="boolean" label="Persistent">
              <value>1</value>
            </field>
            <field var="muc#roomconfig_whois" type="list-single" label="Whois">
              <option label="Mods"><value>moderators</value></option>
              <option label="All"><value>anyone</value></option>
              <value>moderators</value>
            </field>
            <field var="muc#roomconfig_roomadmins" type="jid-multi">
              <desc>Admin list</desc>
              <required/>
              <value>a@x.y</value><value>b@x.y</value>
            </field>
          </x>
        </query>
      </iq>`)
    )
    expect(form?.title).toBe('Config')
    expect(form?.instructions).toBe('Fill it in')
    expect(form?.fields).toHaveLength(4)
    expect(form?.fields[1]).toMatchObject({ type: 'boolean', values: ['1'] })
    expect(form?.fields[2]?.options).toEqual([
      { value: 'moderators', label: 'Mods' },
      { value: 'anyone', label: 'All' }
    ])
    expect(form?.fields[3]?.required).toBe(true)
    expect(form?.fields[3]?.values).toEqual(['a@x.y', 'b@x.y'])
    expect(form?.fields[3]?.desc).toBe('Admin list')
  })

  it('returns null when no data form is present', () => {
    expect(
      parseDataForm(
        xml(`<iq type="result"><query xmlns="http://jabber.org/protocol/muc#owner"/></iq>`)
      )
    ).toBeNull()
  })
})
