// Malformed input generator: raw garbage strings and mutated copies of
// otherwise valid stanzas, for the never-throw fuzz property.

import fc from 'fast-check'

import { iqArb } from './iq'
import { messageArb } from './message'
import { presenceArb } from './presence'

const garbage = fc.oneof(
  fc.string({ maxLength: 160 }),
  fc
    .uint8Array({ maxLength: 120 })
    .map((a) => Array.from(a, (b) => String.fromCharCode(b)).join('')),
  fc.string({
    unit: fc.constantFrom(
      '<',
      '>',
      '/',
      '=',
      '"',
      "'",
      '&',
      ';',
      ':',
      '?',
      '!',
      'a',
      'b',
      ' ',
      '\n'
    ),
    maxLength: 100
  })
)

function mutate(s: string, mode: number, at: number, ins: string): string {
  if (s.length === 0) return ins
  const i = at % s.length
  switch (mode % 4) {
    case 0:
      return s.slice(0, i)
    case 1:
      return s.slice(0, i) + s.slice(Math.min(s.length, i + 1 + (ins.length % 12)))
    case 2:
      return s.slice(0, i) + ins + s.slice(i)
    default:
      return s.slice(0, i) + (ins.length > 0 ? ins.charAt(0) : 'x') + s.slice(i + 1)
  }
}

const stanzaXml = fc.oneof(messageArb, presenceArb, iqArb).map((s) => s.xml)

const mutated = fc
  .tuple(
    stanzaXml,
    fc.integer({ min: 0, max: 3 }),
    fc.nat({ max: 400 }),
    fc.string({ maxLength: 12 })
  )
  .map(([s, mode, at, ins]) => mutate(s, mode, at, ins))

export const malformed = fc.oneof(garbage, mutated, mutated)
