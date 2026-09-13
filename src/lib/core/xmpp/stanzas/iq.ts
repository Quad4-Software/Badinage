// <iq> result parsing: roster, blocklist, disco, data forms, upload
// slots, vcard photos, mam fins and muc invites/declines.

import { bareJid } from '$lib/utils/jid'
import { allNsTags, childElements, firstNsTag, firstTag, firstTagText } from '$lib/utils/xml'

import { NS } from '../ns'
import type {
  DataForm,
  DataFormField,
  DiscoField,
  DiscoForm,
  DiscoIdentity,
  DiscoInfo,
  DiscoItem,
  MamPageResult,
  MucDecline,
  MucInvite,
  RosterItem,
  UploadSlot
} from './types'

export function parseJidItems(el: Element): string[] {
  const jids: string[] = []
  for (const item of allNsTags(el, NS.BLOCKING, 'item')) {
    const jid = item.getAttribute('jid')
    if (jid) jids.push(jid)
  }
  return jids
}

// XEP-0191 push: the server tells every resource which jids entered or
// left the blocklist. A field stays undefined when the push carried no
// matching element; an item-less unblock means the list was cleared.
export function parseBlockPush(stanza: Element): {
  blocked?: string[] | undefined
  unblocked?: string[] | undefined
} {
  const block = firstNsTag(stanza, NS.BLOCKING, 'block')
  const unblock = firstNsTag(stanza, NS.BLOCKING, 'unblock')
  return {
    blocked: block ? parseJidItems(block) : undefined,
    unblocked: unblock ? parseJidItems(unblock) : undefined
  }
}

export function parseRosterItems(stanza: Element): RosterItem[] {
  const items: RosterItem[] = []
  for (const el of allNsTags(stanza, NS.ROSTER, 'item')) {
    items.push({
      jid: el.getAttribute('jid') ?? '',
      name: el.getAttribute('name') ?? '',
      subscription: el.getAttribute('subscription') ?? 'none',
      ask: el.getAttribute('ask') ?? undefined,
      groups: allNsTags(el, NS.ROSTER, 'group').map((g) => g.textContent ?? '')
    })
  }
  return items
}

export function parseDiscoInfo(stanza: Element): DiscoInfo {
  const identities: DiscoIdentity[] = []
  for (const el of allNsTags(stanza, NS.DISCO_INFO, 'identity')) {
    identities.push({
      category: el.getAttribute('category') ?? '',
      type: el.getAttribute('type') ?? '',
      name: el.getAttribute('name') ?? undefined,
      lang: el.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang') ?? undefined
    })
  }
  const features = allNsTags(stanza, NS.DISCO_INFO, 'feature')
    .map((f) => f.getAttribute('var') ?? '')
    .filter((v) => v.length > 0)
  const forms: DiscoForm[] = []
  for (const x of allNsTags(stanza, NS.FORMS, 'x')) {
    if (x.getAttribute('type') !== 'result') continue
    const fields: DiscoField[] = allNsTags(x, NS.FORMS, 'field').map((f) => ({
      var: f.getAttribute('var') ?? '',
      values: allNsTags(f, NS.FORMS, 'value').map((v) => v.textContent ?? '')
    }))
    const formType = fields.find((f) => f.var === 'FORM_TYPE')?.values[0]
    if (formType === undefined) continue
    forms.push({ formType, fields: fields.filter((f) => f.var !== 'FORM_TYPE') })
  }
  return { identities, features, forms }
}

// XEP-0030 disco#items result.
export function parseDiscoItems(stanza: Element): DiscoItem[] {
  const items: DiscoItem[] = []
  for (const el of allNsTags(stanza, NS.DISCO_ITEMS, 'item')) {
    const jid = el.getAttribute('jid')
    if (!jid) continue
    items.push({
      jid,
      node: el.getAttribute('node') ?? undefined,
      name: el.getAttribute('name') ?? undefined
    })
  }
  return items
}

// Does a disco#info result advertise the given feature var.
export function hasDiscoFeature(stanza: Element, featureVar: string): boolean {
  for (const feature of allNsTags(stanza, NS.DISCO_INFO, 'feature')) {
    if (feature.getAttribute('var') === featureVar) return true
  }
  return false
}

// XEP-0363 slot response. The url is an attribute in
// urn:xmpp:http:upload:0 and text content in the newer namespace, so
// accept both.
export function parseUploadSlot(stanza: Element): UploadSlot | null {
  const slot = firstNsTag(stanza, NS.HTTP_UPLOAD, 'slot')
  const put = slot ? firstTag(slot, 'put') : null
  const get = slot ? firstTag(slot, 'get') : null
  const putUrl = put?.getAttribute('url') ?? put?.textContent?.trim() ?? null
  const getUrl = get?.getAttribute('url') ?? get?.textContent?.trim() ?? null
  return putUrl && getUrl ? { putUrl, getUrl } : null
}

// vcard-temp PHOTO as a data uri, or undefined when the stanza carries
// no usable photo. TYPE is sender-controlled, so only image media types
// become a uri - anything else (text/html and friends) is dropped.
export function parseVcardPhoto(stanza: Element): string | undefined {
  const vcard = firstTag(stanza, 'vCard')
  const photo = vcard ? firstTag(vcard, 'PHOTO') : null
  const type = photo ? firstTagText(photo, 'TYPE')?.trim().toLowerCase() : null
  const binval = photo ? firstTagText(photo, 'BINVAL') : null
  if (!type?.startsWith('image/') || !binval) return undefined
  return `data:${type};base64,${binval.trim()}`
}

// A pubsub event notification (XEP-0163) on a message stanza: the node
// that changed plus the published item elements and retracted item ids.

export function parseMamFin(stanza: Element): MamPageResult {
  const fin = firstNsTag(stanza, NS.MAM, 'fin')
  const set = fin ? firstNsTag(fin, NS.RSM, 'set') : null
  const last = set ? firstTagText(set, 'last') : null
  const first = set ? firstTagText(set, 'first') : null
  return {
    complete: fin?.getAttribute('complete') === 'true',
    last: last ?? undefined,
    first: first ?? undefined
  }
}

// direct children in a namespace; descendant search would overmatch
// nested structures like data form option values
function childNsTags(el: Element, ns: string, local: string): Element[] {
  return childElements(el).filter((e) => e.localName === local && e.namespaceURI === ns)
}

// XEP-0249 direct invites and XEP-0045 mediated invites share one
// parsed shape. Direct invites come from the inviter with a
// jabber:x:conference x element naming the room; mediated invites come
// from the room itself with a muc#user invite element naming the
// inviter.
export function parseRoomInvite(stanza: Element): MucInvite | null {
  const direct = firstNsTag(stanza, NS.DIRECT_INVITE, 'x')
  const room = direct?.getAttribute('jid')
  if (direct && room) {
    const invite: MucInvite = {
      room,
      from: stanza.getAttribute('from') ?? '',
      kind: 'direct',
      password: direct.getAttribute('password') ?? undefined,
      reason: direct.getAttribute('reason') ?? undefined
    }
    const cont = direct.getAttribute('continue')
    if (cont === 'true' || cont === '1') invite.continueSession = true
    return invite
  }

  const x = firstNsTag(stanza, NS.MUC_USER, 'x')
  const invite = x ? firstNsTag(x, NS.MUC_USER, 'invite') : null
  if (!x || !invite) return null
  return {
    room: bareJid(stanza.getAttribute('from') ?? ''),
    from: invite.getAttribute('from') ?? '',
    kind: 'mediated',
    // the room passes the password through as a sibling of the invite
    password: firstNsTag(x, NS.MUC_USER, 'password')?.textContent ?? undefined,
    reason: firstNsTag(invite, NS.MUC_USER, 'reason')?.textContent ?? undefined
  }
}

// XEP-0045: the room relays a decline to the inviter.
export function parseRoomDecline(stanza: Element): MucDecline | null {
  const x = firstNsTag(stanza, NS.MUC_USER, 'x')
  const decline = x ? firstNsTag(x, NS.MUC_USER, 'decline') : null
  if (!x || !decline) return null
  return {
    room: bareJid(stanza.getAttribute('from') ?? ''),
    from: decline.getAttribute('from') ?? '',
    reason: firstNsTag(decline, NS.MUC_USER, 'reason')?.textContent ?? undefined
  }
}

// XEP-0004: parse a jabber:x:data form into a generic shape the ui can
// render without knowing the consumer (room config today).
export function parseDataForm(stanza: Element): DataForm | null {
  const x = firstNsTag(stanza, NS.FORMS, 'x')
  if (!x) return null
  const form: DataForm = { fields: [] }
  const title = childNsTags(x, NS.FORMS, 'title')[0]?.textContent
  if (title) form.title = title
  const instructions = childNsTags(x, NS.FORMS, 'instructions')[0]?.textContent
  if (instructions) form.instructions = instructions
  for (const field of childNsTags(x, NS.FORMS, 'field')) {
    const parsed: DataFormField = {
      var: field.getAttribute('var') ?? '',
      type: field.getAttribute('type') ?? undefined,
      label: field.getAttribute('label') ?? undefined,
      desc: childNsTags(field, NS.FORMS, 'desc')[0]?.textContent ?? undefined,
      required: childNsTags(field, NS.FORMS, 'required').length > 0,
      values: childNsTags(field, NS.FORMS, 'value').map((v) => v.textContent ?? ''),
      options: childNsTags(field, NS.FORMS, 'option').map((option) => ({
        value: childNsTags(option, NS.FORMS, 'value')[0]?.textContent ?? '',
        label: option.getAttribute('label') ?? undefined
      }))
    }
    form.fields.push(parsed)
  }
  return form
}
