# @quad4-software/badinage-omemo

OMEMO (XEP-0384) end-to-end encryption for XMPP, in TypeScript.

Supports both profiles of the spec:

- `omemo2`: `urn:xmpp:omemo:2` (XEP-0384 0.8+). Ed25519 identity keys,
  X3DH over X25519, Double Ratchet with AES-256-CBC + HMAC-SHA-256.
- `legacy`: `eu.siacs.conversations.axolotl` (XEP-0384 0.3.0). Curve25519
  identity keys with XEdDSA signatures, the same ratchet construction, and
  AES-128-GCM payload encryption where the ratchet plaintext is
  `key || tag`.

Runs in browsers, Node 22+ and workers. No DOM, no Node APIs. Randomness
comes from `crypto.getRandomValues`. The only dependencies are
`@noble/ciphers`, `@noble/curves` and `@noble/hashes`.

## Install

```sh
pnpm add @quad4-software/badinage-omemo
```

Or build it from a checkout:

```sh
pnpm --filter @quad4-software/badinage-omemo build
```

## Usage

```ts
import {
  OmemoManager,
  InMemoryOmemoStore,
  serializeSceEnvelope,
  textEnvelope
} from '@quad4-software/badinage-omemo'

const alice = await OmemoManager.create({
  namespace: 'omemo2',
  store: new InMemoryOmemoStore(),
  ownJid: 'alice@example.org'
})

const bundle = await alice.buildBundle() // publish via PEP

// encrypt to bob's device 42 after fetching and parsing his bundle
const encrypted = await alice.encrypt({
  recipients: [{ jid: 'bob@example.org', deviceId: 42, bundle: parsedBobBundle }],
  plaintext: new TextEncoder().encode(serializeSceEnvelope(textEnvelope('hello', [])))
})
```

`encrypt` returns an `<encrypted>` XML element to embed in a stanza.
`decrypt` reverses it. Sessions persist through the `OmemoStore`
interface. `InMemoryOmemoStore` is provided for tests. Production storage
should wrap key material before writing it to IndexedDB.

## Testing and interoperability

```sh
pnpm test          # unit, property, conformance and interop tests
pnpm test:interop  # only the reference-implementation vectors
pnpm typecheck     # src
pnpm run docs      # TypeDoc API docs into docs/api
```

## License

0BSD. See LICENSE.
