// Public surface of the stanza parsers. Import as
// '$lib/core/xmpp/stanzas' exactly as before the split.

export {
  parseBlockPush,
  parseDataForm,
  parseDiscoInfo,
  parseDiscoItems,
  parseJidItems,
  parseMamFin,
  parseRosterItems,
  parseRoomDecline,
  parseRoomInvite,
  parseUploadSlot,
  parseVcard,
  parseVcardPhoto,
  hasDiscoFeature
} from './iq'
export { parseMessage } from './message'
export {
  parseChannelSearchItems,
  parseMdsItem,
  type ChannelSearchItem,
  type MdsDisplayed
} from './payloads'
export { parseBookmark, parseBookmarkItems, parsePepEvent } from './pep'
export { parseAvatarHash, parseCaps, parsePresence } from './presence'
export type {
  Attachment,
  Bookmark,
  CapsRef,
  ChatState,
  DataForm,
  DataFormField,
  DiscoForm,
  DiscoIdentity,
  DiscoInfo,
  DiscoItem,
  Geoloc,
  IncomingMessage,
  MamPageResult,
  MarkerType,
  MessageReference,
  MucDecline,
  MucInvite,
  MucOccupant,
  NotifySetting,
  PresenceError,
  PresenceUpdate,
  RosterItem,
  TrustOwner,
  UploadSlot,
  Vcard
} from './types'
