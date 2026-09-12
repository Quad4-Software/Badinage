import type { Module, ModuleContext } from '$lib/core/module'

// OMEMO (XEP-0384) support boundary.
//
// The only maintained JS implementation, libomemo.js, is GPL-3.0 and pulls in a
// WASM crypto module. This app is 0BSD. Options tracked in TODO.md:
//   a) relicense the distributed bundle as GPL-3.0 and dynamically import it
//   b) write a permissively licensed X3DH + double ratchet implementation
//   c) wait for MLS (RFC 9420) XMPP drafts to mature
//
// Until a decision is made this module is a no-op so the wiring stays in place.

export const omemoModule: Module = {
  id: 'omemo',
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  init(_ctx: ModuleContext) {}
}
