export const NS = {
  CLIENT: 'jabber:client',
  ROSTER: 'jabber:iq:roster',
  DISCO_INFO: 'http://jabber.org/protocol/disco#info',
  DISCO_ITEMS: 'http://jabber.org/protocol/disco#items',
  MUC: 'http://jabber.org/protocol/muc',
  MUC_USER: 'http://jabber.org/protocol/muc#user',
  MUC_ADMIN: 'http://jabber.org/protocol/muc#admin',
  MUC_OWNER: 'http://jabber.org/protocol/muc#owner',
  MAM: 'urn:xmpp:mam:2',
  RSM: 'http://jabber.org/protocol/rsm',
  FORMS: 'jabber:x:data',
  STANZA_IDS: 'urn:xmpp:sid:0',
  CHAT_STATES: 'http://jabber.org/protocol/chatstates',
  CARBONS: 'urn:xmpp:carbons:2',
  FORWARD: 'urn:xmpp:forward:0',
  SM: 'urn:xmpp:sm:3',
  DELAY: 'urn:xmpp:delay',
  HTTP_UPLOAD: 'urn:xmpp:http:upload:0',
  VCARD_AVATAR: 'urn:xmpp:avatar:metadata',
  VCARD_TEMP: 'vcard-temp',
  BLOCKING: 'urn:xmpp:blocking',
  OMEMO: 'urn:xmpp:omemo:2',
  OMEMO_LEGACY: 'eu.siacs.conversations.axolotl',
  SCE: 'urn:xmpp:sce:1',
  // XEP-0380 explicit encryption announcement + XEP-0334 storage hint
  EME: 'urn:xmpp:eme:0',
  HINTS: 'urn:xmpp:hints',
  BOOKMARKS: 'urn:xmpp:bookmarks:1',
  PUBSUB: 'http://jabber.org/protocol/pubsub',
  RECEIPTS: 'urn:xmpp:receipts',
  MARKERS: 'urn:xmpp:chat-markers:0',
  REPLY: 'urn:xmpp:reply:0',
  REACTIONS: 'urn:xmpp:reactions:0',
  CORRECT: 'urn:xmpp:message-correct:0',
  OOB: 'jabber:x:oob',
  FILE_METADATA: 'urn:xmpp:file:metadata:0',
  SIMS: 'urn:xmpp:sims:0',
  REFERENCE: 'urn:xmpp:reference:0',
  // XEP-0249 direct invitation payload
  DIRECT_INVITE: 'jabber:x:conference',
  // XEP-0199 ping, also used for MUC self-ping
  PING: 'urn:xmpp:ping',
  // XEP-0352 client state indication nonzas
  CSI: 'urn:xmpp:csi:0',
  // XEP-0077 iq payload and its pre-auth stream feature
  REGISTER: 'jabber:iq:register',
  REGISTER_FEATURE: 'http://jabber.org/features/iq-register',
  // XEP-0421 stable occupant identifiers
  OCCUPANT_ID: 'urn:xmpp:occupant-id:0',
  // XEP-0425 moderated message retraction, version 1 of the protocol
  // dropped the fasten apply-to wrapper in favor of a direct iq
  MESSAGE_MODERATE: 'urn:xmpp:message-moderate:1',
  // XEP-0424 message retraction, shared with XEP-0425 tombstones. The
  // current spec retracts via a direct <retract> child in
  // urn:xmpp:message-retract:1; older drafts wrapped a
  // urn:xmpp:message-retract:0 element in a fasten apply-to, which we
  // still accept on the receive side for interop.
  MESSAGE_RETRACT: 'urn:xmpp:message-retract:1',
  MESSAGE_RETRACT_LEGACY: 'urn:xmpp:message-retract:0',
  FASTEN: 'urn:xmpp:fasten:0',
  FALLBACK: 'urn:xmpp:fallback:0',
  // XEP-0382 spoiler hint element
  SPOILER: 'urn:xmpp:spoiler:0',
  // XEP-0393 message styling: used for the unstyled opt-out element
  STYLING: 'urn:xmpp:styling:0',
  // RFC 6120 stanza error conditions
  STANZA_ERROR: 'urn:ietf:params:xml:ns:xmpp-stanzas'
} as const

// XEP-0156 host-meta link relations used by endpoint discovery. These are
// link rel values, not stanza namespaces, so they live next to but outside
// the NS table.
export const HOST_META_REL = {
  WEBSOCKET: 'urn:xmpp:alt-connections:websocket',
  BOSH: 'urn:xmpp:alt-connections:xbosh'
} as const
