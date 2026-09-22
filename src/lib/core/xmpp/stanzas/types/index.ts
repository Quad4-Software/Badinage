// Stanza type barrel. Parsed shapes are split by domain: message.ts
// covers the IncomingMessage event, presence.ts the presence and MUC
// shapes, meta.ts roster/disco/forms/bookmarks and the rest.

export type {
  Attachment,
  ChatState,
  Geoloc,
  IncomingMessage,
  MarkerType,
  MessageReference,
  TrustOwner
} from './message'
export type {
  Bookmark,
  CapsRef,
  DataForm,
  DataFormField,
  DiscoField,
  DiscoForm,
  DiscoIdentity,
  DiscoInfo,
  DiscoItem,
  MamPageResult,
  NotifySetting,
  RosterItem,
  UploadSlot,
  Vcard
} from './meta'
export type { MucDecline, MucInvite, MucOccupant, PresenceError, PresenceUpdate } from './presence'
