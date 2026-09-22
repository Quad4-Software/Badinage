// The public contract of the XMPP transport layer: the ChatConnection
// interface the state layer programs against plus the option and event
// types it references. XmppConnection in ../connection.ts implements it.
// DemoConnection in ../demo.ts fakes it. ../connection.ts re-exports all
// of this so existing importers keep working.

export type {
  AttachmentMeta,
  ChatKind,
  ConnectionStatus,
  SendMessageOptions,
  TransportCapabilities,
  VcardApi
} from './api'
export type { ChatConnection, ConnectionEvents } from './connection'
