// Error types raised by this library. All errors extend OmemoError so callers
// can catch broadly or discriminate on the concrete subclass.

export class OmemoError extends Error {
  constructor(message?: string) {
    super(message)
    this.name = new.target.name
  }
}

export class ProtocolError extends OmemoError {}
export class DecryptionFailedError extends OmemoError {}
export class AuthenticationError extends OmemoError {}
export class KeyExchangeError extends OmemoError {}
export class InvalidSignatureError extends KeyExchangeError {}
export class MissingPreKeyError extends KeyExchangeError {}
export class DoSProtectionError extends OmemoError {}
export class DuplicateMessageError extends OmemoError {}
export class ParseError extends OmemoError {}
