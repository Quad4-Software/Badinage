// Extension system types and limits. An extension is a single JS
// bundle shipped inside a signed JSON package. It runs in a dedicated
// worker with DOM, network and storage intrinsics stripped, and talks
// to the host over a narrow validated RPC channel.

// bump when the api object changes shape. Extensions declaring a
// newer api are refused, older ones load unless below MIN_API
export const EXT_API_VERSION = 1
export const MIN_API_VERSION = 1

export const KNOWN_PERMISSIONS = [
  'menus',
  'toast',
  'storage',
  'net',
  'messages.read',
  'messages.decorate',
  'commands',
  'settings'
] as const
export type Permission = (typeof KNOWN_PERMISSIONS)[number]

export interface ExtManifest {
  // reverse-dns style identifier, unique per extension
  id: string
  name: string
  version: string
  api: number
  description?: string
  // publisher key is the base64 ed25519 public key that signed the
  // package. Absent means unsigned
  publisher?: { name: string; key: string }
  permissions: Permission[]
  // origins the extension may reach through the proxied net.fetch.
  // https and wss only, origin form, no paths
  connect: string[]
}

export interface ExtPackage {
  manifest: ExtManifest
  signature?: string
  code: string
}

// what we persist about an installed extension. The bundle itself lives
// in IndexedDB keyed by id, this record is metadata only
export interface InstalledExt {
  id: string
  name: string
  version: string
  api: number
  description?: string
  publisherName?: string
  // sha-256 fingerprint of the publisher key, for display and pinning
  keyFingerprint?: string
  signed: boolean
  enabled: boolean
  // api below MIN_API_VERSION on load marks the extension outdated and
  // keeps it disabled until an update arrives
  outdated: boolean
  // cumulative worker errors since the last enable, drives auto-disable
  errors: number
  permissions: Permission[]
  connect: string[]
  installedAt: number
  source?: string
}

// a menu contribution an extension announces over the wire
export interface ExtMenuItem {
  id: string
  section: string
  label: string
  danger?: boolean
}

// a slash command an extension announces over the wire. Handlers
// receive {name, args, peerJid, kind} and may return {body} to send
export interface ExtCommand {
  id: string
  name: string
  description: string
}

// declarative settings field. The host renders these in a configure
// dialog and stores values in the extension's own kv namespace
export interface ExtSettingField {
  key: string
  type: 'text' | 'number' | 'checkbox' | 'select'
  label: string
  options?: string[]
  default?: string | number | boolean
}

// render-time additions a decorator may attach to a message. Body
// rewriting is intentionally absent: display integrity stays with us
export interface ExtDecoration {
  footer?: string
  title?: string
}

export interface TrustedPublisher {
  key: string
  name: string
  trustedAt: number
  source?: string
}

export const EXT_LIMITS = {
  idPattern: /^[a-z0-9][a-z0-9.-]{2,63}$/,
  versionPattern: /^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$/,
  nameMax: 64,
  descriptionMax: 256,
  codeMaxBytes: 512 * 1024,
  connectMax: 8,
  storageValueMaxBytes: 64 * 1024,
  netResponseMaxBytes: 256 * 1024,
  callTimeoutMs: 3000,
  readyTimeoutMs: 5000,
  errorLimit: 5,
  menuItemsMax: 10,
  commandsMax: 10,
  settingsFieldsMax: 20,
  settingOptionsMax: 20,
  decorationTextMax: 200,
  decorationsCacheMax: 500
} as const
