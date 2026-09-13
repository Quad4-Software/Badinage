// Stanza generators for the property tests: structured XMPP stanzas with
// junk mixed in, and malformed/mutated input for the fuzz property.

import fc from 'fast-check'

import { iqArb } from './iq'
import { messageArb } from './message'
import { presenceArb } from './presence'
import type { StanzaCase } from './common'

export const stanzaArb: fc.Arbitrary<StanzaCase> = fc.oneof(messageArb, presenceArb, iqArb)

export * from './common'
export { iqArb } from './iq'
export { malformed } from './malformed'
export { messageArb } from './message'
export { presenceArb } from './presence'
