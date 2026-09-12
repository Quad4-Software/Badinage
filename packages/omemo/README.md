# @quad4-software/omemo

OMEMO (XEP-0384) end-to-end encryption for XMPP, in TypeScript.

Supports both profiles of the spec:

- `omemo2` — `urn:xmpp:omemo:2` (XEP-0384 0.8+). Ed25519 identity keys,
  X3DH over X25519, Double Ratchet with AES-256-CBC + HMAC-SHA-256.
- `legacy` — `eu.siacs.conversations.axolotl` (XEP-0384 0.3.0). Curve25519
  identity keys with XEdDSA signatures, the same ratchet construction, and
  AES-128-GCM payload encryption where the ratchet plaintext is
  `key || tag`.

Runs in browsers, Node 22+ and workers. No DOM, no Node APIs. Randomness
comes from `crypto.getRandomValues`. The only dependencies are
`@noble/ciphers`, `@noble/curves` and `@noble/hashes`.

## Install

Published to GitHub Packages. Point the scope at the GitHub registry and
authenticate with a token that has `read:packages`:

```sh
# .npmrc
@quad4-software:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```sh
pnpm add @quad4-software/omemo
```

Or build it from a checkout:

```sh
pnpm --filter @quad4-software/omemo build
```

## Usage

```ts
import {
  OmemoManager,
  InMemoryOmemoStore,
  serializeSceEnvelope,
  textEnvelope
} from '@quad4-software/omemo'

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

`encrypt` returns an `<encrypted>` XML element to embed in a stanza;
`decrypt` reverses it. Sessions persist through the `OmemoStore`
interface; `InMemoryOmemoStore` is provided for tests. Production storage
should wrap key material before writing it to IndexedDB.

## Layout

- `src/crypto` — curves, KDFs, AES wrappers, XEdDSA
- `src/protocol` — protobuf wire structs, X3DH, Double Ratchet session,
  bundles, key exchange, payload crypto, SCE envelope, wire elements
- `src/store` — async storage contract plus in-memory implementation
- `src/internal` — byte helpers, base64, mini XML and protobuf codecs

## Testing and interoperability

```sh
pnpm test          # unit, property, conformance and interop tests
pnpm test:interop  # only the reference-implementation vectors
pnpm typecheck     # src
pnpm run docs      # TypeDoc API docs into docs/api
```

`test/interop` replays golden vectors produced by `scripts/gen_vectors.py`
with the Python reference stack (xeddsa, x3dh, doubleratchet, oldmemo,
twomemo). Vectors cover HKDF, AES, XEdDSA, X25519, Ed25519-to-Curve25519
conversion, X3DH, the Double Ratchet in both profiles (in-order,
out-of-order, reply direction), the protobuf wire formats and the
`<encrypted>`/`<bundle>` XML. `scripts/py_verify.py` also lets the
reference implementation verify our signatures and decrypt our
ciphertexts.

Wire differences between the profiles worth knowing: the legacy profile
keeps the Signal field numbering (OMEMOMessage `dh_pub=1, n=2, pn=3,
ciphertext=4`; OMEMOKeyExchange `pk_id=1, ek=2, ik=3, message=4,
spk_id=6`), prepends a `0x33` version byte inside the MAC, appends an
8-byte MAC as a raw concatenation instead of a protobuf wrapper, uses
33-byte `0x05`-prefixed Curve25519 keys, and orders associated data as
sender identity key then recipient identity key regardless of who
initiated the session.

## License

0BSD. See LICENSE.
