import { describe, expect, it } from 'vitest'

import {
  base64Decode,
  base64Encode,
  bytesEqual,
  bytesToHex,
  hexToBytes,
  randomBytes,
  utf8ToBytes
} from '../src/internal/bytes'
import { el, findChild, parseXml, serializeXml } from '../src/internal/xml'
import { ProtoWriter, readFields, requireBytes, requireVarint } from '../src/internal/protobuf'
import {
  decodeAuthenticatedMessage,
  decodeBundle,
  decodeKeyExchange,
  decodeOmemoMessage,
  encodeAuthenticatedMessage,
  encodeBundle,
  encodeKeyExchange,
  encodeOmemoMessage
} from '../src/protocol/messages'

describe('bytes', () => {
  it('base64 round trips', () => {
    const data = randomBytes(97)
    expect(bytesEqual(base64Decode(base64Encode(data)), data)).toBe(true)
  })

  it('base64 matches known encoding', () => {
    expect(base64Encode(utf8ToBytes('hello'))).toBe('aGVsbG8=')
    expect(bytesToHex(base64Decode('AAEC'))).toBe('000102')
  })

  it('hex round trips', () => {
    expect(bytesToHex(hexToBytes('deadbeef'))).toBe('deadbeef')
  })
})

describe('xml', () => {
  it('serializes and parses nested elements', () => {
    const doc = el('a', { xmlns: 'test', x: '1 & 2' }, [el('b', {}, [], 'text <here>'), el('c')])
    const parsed = parseXml(serializeXml(doc))
    expect(parsed.name).toBe('a')
    expect(parsed.attrs['x']).toBe('1 & 2')
    expect(findChild(parsed, 'b')?.text).toBe('text <here>')
  })

  it('rejects mismatched tags', () => {
    expect(() => parseXml('<a></b>')).toThrow()
  })
})

describe('protobuf', () => {
  it('round trips varint and bytes fields', () => {
    const data = new ProtoWriter()
      .fieldVarint(1, 42)
      .fieldBytes(2, utf8ToBytes('hi'))
      .fieldVarint(15, 0x7fffffff)
      .finish()
    const fields = readFields(data)
    expect(requireVarint(fields, 1, 't')).toBe(42)
    expect(requireBytes(fields, 2, 't')).toEqual(utf8ToBytes('hi'))
    expect(requireVarint(fields, 15, 't')).toBe(0x7fffffff)
  })

  it('skips unknown fields', () => {
    const data = new ProtoWriter().fieldVarint(1, 7).fieldBytes(99, utf8ToBytes('x')).finish()
    const fields = readFields(data)
    expect(requireVarint(fields, 1, 't')).toBe(7)
  })

  it('round trips OMEMOMessage', () => {
    const msg = { n: 3, pn: 2, dhPub: randomBytes(32), ciphertext: randomBytes(48) }
    expect(decodeOmemoMessage(encodeOmemoMessage(msg))).toEqual(msg)
  })

  it('round trips OMEMOAuthenticatedMessage', () => {
    const msg = { mac: randomBytes(16), message: randomBytes(40) }
    expect(decodeAuthenticatedMessage(encodeAuthenticatedMessage(msg))).toEqual(msg)
  })

  it('round trips OMEMOKeyExchange', () => {
    const kex = {
      pkId: 5,
      spkId: 7,
      ik: randomBytes(32),
      ek: randomBytes(32),
      message: randomBytes(60)
    }
    expect(decodeKeyExchange(encodeKeyExchange(kex))).toEqual(kex)
  })

  it('round trips OMEMOBundle', () => {
    const bundle = {
      spkId: 1,
      spk: randomBytes(32),
      spkSignature: randomBytes(64),
      ik: randomBytes(32),
      preKeys: [
        { pkId: 1, pk: randomBytes(32) },
        { pkId: 2, pk: randomBytes(32) }
      ]
    }
    expect(decodeBundle(encodeBundle(bundle))).toEqual(bundle)
  })
})
