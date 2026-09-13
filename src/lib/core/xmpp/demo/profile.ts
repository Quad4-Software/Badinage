// Demo-mode profile fixtures: a generated initials tile for some of the
// contacts, the app mark for the lobby room, and an in-memory own vcard
// so the profile editor and avatar publishing work without a server.

import { APP_ICON_192 } from '$lib/constants'
import { bareJid } from '$lib/utils/jid'

import { ROOM } from '../demo-data'
import type { Vcard } from '../stanzas'
import type { VcardApi } from '../types'

// small svg tile rendered to a data uri. The contacts below keep their
// colors stable across reloads because the hue is fixed
function svgAvatar(initials: string, hue: number): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='hsl(${hue} 55% 45%)'/><text x='32' y='42' font-family='sans-serif' font-size='24' fill='#fff' text-anchor='middle'>${initials}</text></svg>`
  return `data:image/svg+xml;base64,${btoa(svg)}`
}

const CONTACT_AVATARS: Record<string, string> = {
  'aria@badinage.local': svgAvatar('Ar', 195),
  'cleo@badinage.local': svgAvatar('Cl', 325),
  'dmitri@badinage.local': svgAvatar('Dm', 25)
}

export class DemoProfiles {
  private card: Vcard = {
    fn: 'Demo User',
    nickname: 'demo',
    desc: 'Trying out Badinage without a server'
  }
  private ownAvatar = ''

  // the fetchAvatar stand-in: own card first, then the room mark, then
  // the generated contact tiles. Occupant keys arrive as room/nick and
  // resolve to the matching contact tile.
  avatar(jid: string, ownJid: string): string | undefined {
    if (jid === bareJid(ownJid)) return this.ownAvatar || undefined
    if (jid === ROOM) return APP_ICON_192
    const contactJid = jid.startsWith(`${ROOM}/`)
      ? `${jid.slice(ROOM.length + 1)}@badinage.local`
      : jid
    return CONTACT_AVATARS[contactJid]
  }

  readonly vcard: VcardApi = {
    fetch: (onDone) => onDone({ ...this.card }),
    set: (vcard, onDone) => {
      this.card = { ...vcard }
      this.ownAvatar = vcard.photoUri ?? ''
      onDone(true)
    }
  }
}
