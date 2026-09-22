// Stanza meta shapes: roster items, data forms, disco results, vcards,
// bookmarks, upload slots and MAM page results.

export interface RosterItem {
  jid: string
  name: string
  subscription: string
  ask?: string | undefined
  groups: string[]
}

// XEP-0004 data form, parsed generically so room configuration and any
// future form consumer share one shape.
interface DataFormOption {
  value: string
  label?: string | undefined
}

export interface DataFormField {
  var: string
  type?: string | undefined
  label?: string | undefined
  desc?: string | undefined
  required: boolean
  values: string[]
  options: DataFormOption[]
}

export interface DataForm {
  title?: string | undefined
  instructions?: string | undefined
  fields: DataFormField[]
}

// XEP-0115 c element: node identifies the client software, ver is the
// verification string hashing the advertised identity and features
export interface CapsRef {
  node: string
  hash: string
  ver: string
}

// XEP-0030 disco#info result
export interface DiscoIdentity {
  category: string
  type: string
  name?: string | undefined
  lang?: string | undefined
}

// one field of a XEP-0128 service discovery extension form
export interface DiscoField {
  var: string
  values: string[]
}

export interface DiscoForm {
  formType: string
  fields: DiscoField[]
}

export interface DiscoInfo {
  identities: DiscoIdentity[]
  features: string[]
  forms: DiscoForm[]
}

// XEP-0030 disco#items entry
export interface DiscoItem {
  jid: string
  node?: string | undefined
  name?: string | undefined
}

// XEP-0402 PEP bookmark. kind 'contact' is serialized as a contact
// element in the bookmarks namespace: the spec only defines conference,
// so this is a client-local extension that other clients ignore.
// XEP-0492 fallback notification setting carried on a bookmark. The
// identity-specific variants are parsed but only the attribute-free
// fallback drives our behavior.
export type NotifySetting = 'always' | 'on-mention' | 'never'

// XEP-0054 vcard-temp profile. Only the fields the profile editor
// manages are parsed. PhotoUri is the PHOTO element as a data uri,
// absent when the card carries no image photo.
export interface Vcard {
  fn: string
  nickname: string
  desc: string
  photoUri?: string | undefined
}

export interface Bookmark {
  jid: string
  kind: 'conference' | 'contact'
  name?: string | undefined
  autojoin?: boolean | undefined
  nick?: string | undefined
  password?: string | undefined
  // XEP-0492 notify element found inside the bookmark extensions
  notify?: NotifySetting | undefined
  // serialized extension children we do not understand, kept verbatim so
  // republishing the bookmark does not strip them (XEP-0402 rule)
  extensionsXml?: string[] | undefined
}

// XEP-0363 slot granted by an upload service: PUT the file to putUrl,
// share getUrl.
export interface UploadSlot {
  putUrl: string
  getUrl: string
}

// One page of a MAM query result. rsm uid of the oldest row in this
// page is first - pass it as before to fetch the next older page.
export interface MamPageResult {
  complete: boolean
  last?: string | undefined
  first?: string | undefined
}
