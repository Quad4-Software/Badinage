// Minimal protobuf codec supporting the wire types the OMEMO schemas need:
// varints and length-delimited fields. Unknown fields are skipped on decode so
// readers stay forward compatible.

import { ParseError } from '../errors'

export const WIRE_VARINT = 0
export const WIRE_64BIT = 1
export const WIRE_LENGTH = 2
export const WIRE_32BIT = 5

export interface ProtoField {
  number: number
  wireType: number
  varint: bigint | undefined
  bytes: Uint8Array | undefined
}

export function encodeVarint(value: bigint): number[] {
  if (value < 0n) throw new Error('negative varints unsupported')
  const out: number[] = []
  let v = value
  do {
    let byte = Number(v & 0x7fn)
    v >>= 7n
    if (v > 0n) byte |= 0x80
    out.push(byte)
  } while (v > 0n)
  return out
}

export class ProtoWriter {
  private readonly chunks: number[] = []

  fieldVarint(number: number, value: number | bigint): this {
    this.tag(number, WIRE_VARINT)
    this.chunks.push(...encodeVarint(BigInt(value)))
    return this
  }

  fieldBytes(number: number, value: Uint8Array): this {
    this.tag(number, WIRE_LENGTH)
    this.chunks.push(...encodeVarint(BigInt(value.length)))
    for (const byte of value) this.chunks.push(byte)
    return this
  }

  private tag(number: number, wireType: number): void {
    if (number < 1) throw new Error('invalid field number')
    this.chunks.push(...encodeVarint(BigInt((number << 3) | wireType)))
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.chunks)
  }
}

export function readFields(data: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = []
  let pos = 0

  const readVarint = (): bigint => {
    let result = 0n
    let shift = 0n
    for (;;) {
      if (pos >= data.length) throw new ParseError('truncated varint')
      const byte = data[pos++] ?? 0
      result |= BigInt(byte & 0x7f) << shift
      if ((byte & 0x80) === 0) return result
      shift += 7n
      if (shift > 70n) throw new ParseError('varint too long')
    }
  }

  while (pos < data.length) {
    const tag = readVarint()
    const number = Number(tag >> 3n)
    const wireType = Number(tag & 7n)
    const field: ProtoField = { number, wireType, varint: undefined, bytes: undefined }
    switch (wireType) {
      case WIRE_VARINT:
        field.varint = readVarint()
        break
      case WIRE_LENGTH: {
        const length = Number(readVarint())
        if (length < 0 || pos + length > data.length) throw new ParseError('truncated field')
        field.bytes = data.slice(pos, pos + length)
        pos += length
        break
      }
      case WIRE_32BIT:
        if (pos + 4 > data.length) throw new ParseError('truncated field')
        field.bytes = data.slice(pos, pos + 4)
        pos += 4
        break
      case WIRE_64BIT:
        if (pos + 8 > data.length) throw new ParseError('truncated field')
        field.bytes = data.slice(pos, pos + 8)
        pos += 8
        break
      default:
        throw new ParseError(`unsupported wire type ${wireType}`)
    }
    fields.push(field)
  }
  return fields
}

export function getVarint(fields: ProtoField[], number: number): bigint | undefined {
  const field = fields.find((candidate) => candidate.number === number)
  return field && field.varint !== undefined ? field.varint : undefined
}

export function requireVarint(fields: ProtoField[], number: number, schema: string): number {
  const value = getVarint(fields, number)
  if (value === undefined || value < 0n || value > 0xffffffffn) {
    throw new ParseError(`${schema}: missing or invalid field ${number}`)
  }
  return Number(value)
}

export function getBytes(fields: ProtoField[], number: number): Uint8Array | undefined {
  const field = fields.find((candidate) => candidate.number === number)
  return field?.bytes
}

export function requireBytes(fields: ProtoField[], number: number, schema: string): Uint8Array {
  const value = getBytes(fields, number)
  if (value === undefined) throw new ParseError(`${schema}: missing field ${number}`)
  return value
}
