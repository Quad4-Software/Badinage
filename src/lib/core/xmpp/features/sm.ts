// XEP-0198 stream management glue. Strophe implements the protocol itself
// when the enableStreamManagement connection option is set: it sends
// <enable resume="true"/> after resource binding, counts inbound and
// outbound stanzas, answers <r/> with <a h/>, asks for an ack every
// maxUnacked sends, and persists the resumable session {id, h, location,
// max}. On reconnect it injects <resume previd h/> inside the post-SASL
// stream-features dispatch, before resource binding, so a resumable
// session skips bind entirely. <resumed h/> reconciles the counters and
// re-sends unacked stanzas in wire order; <failed/> falls back to a
// normal bind and salvages the queue for re-send once the fresh session
// is enabled. All of that lives upstream in strophe's StreamManagement
// engine (src/stream-management in the package), negotiated only over
// WebSocket transports.
//
// What this module adds on top:
//
// - ScopedSmStorage routes strophe's persistence through scopedKey so the
//   SM state sits under the same badinage:<bare-jid>: sessionStorage
//   namespacing as every other per-account key. strophe hands the backend
//   keys shaped like strophe-sm:<bare-jid>; we recover the jid and re-key
//   it. In environments without sessionStorage (unit tests, workers) the
//   backend falls back to memory, which still covers in-session drops.
// - smConnectionOptions() keeps the Connection constructor free of SM
//   internals.

import type { ConnectionOptions, SMState, SMStorageBackend } from 'strophe.js'

import { SM_ACK_EVERY } from '$lib/constants'
import { scopedKey } from '$lib/core/storage/keys'

const STROPHE_SM_PREFIX = 'strophe-sm:'

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

// In-memory stand-in for sessionStorage where the platform lacks one.
// Module-level so every ScopedSmStorage instance sees the same data
// within the process.
const memory = new Map<string, string>()
const memoryStore: Store = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => void memory.set(key, value),
  removeItem: (key) => void memory.delete(key)
}

function store(): Store {
  return typeof sessionStorage === 'undefined' ? memoryStore : sessionStorage
}

function smKey(key: string): string {
  const jid = key.startsWith(STROPHE_SM_PREFIX) ? key.slice(STROPHE_SM_PREFIX.length) : key
  return scopedKey(jid, 'sm')
}

export class ScopedSmStorage implements SMStorageBackend {
  load(key: string): SMState | null {
    const raw = store().getItem(smKey(key))
    if (!raw) return null
    try {
      return JSON.parse(raw) as SMState
    } catch {
      store().removeItem(smKey(key))
      return null
    }
  }

  save(key: string, state: SMState): void {
    store().setItem(smKey(key), JSON.stringify(state))
  }

  clear(key: string): void {
    store().removeItem(smKey(key))
  }
}

// Options fragment for new Strophe.Connection(). SM only negotiates over
// websocket transports; on BOSH the option is inert.
export function smConnectionOptions(): ConnectionOptions {
  return {
    enableStreamManagement: true,
    streamManagement: {
      maxUnacked: SM_ACK_EVERY,
      storage: new ScopedSmStorage()
    }
  }
}
