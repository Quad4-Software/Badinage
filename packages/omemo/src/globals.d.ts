// Ambient declarations for the web platform globals this library uses. All of
// these exist in browsers, workers and Node 22+. Declaring them here avoids
// pulling in the DOM lib, which would imply DOM dependencies this package
// does not have.

declare class TextEncoder {
  encode(input?: string): Uint8Array
}

declare class TextDecoder {
  decode(input?: Uint8Array): string
}

interface CryptoLike {
  getRandomValues<T extends ArrayBufferView>(array: T): T
}

declare const crypto: CryptoLike

declare function structuredClone<T>(value: T): T
