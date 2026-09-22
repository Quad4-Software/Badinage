// Demo directory data: roster items, PEP bookmarks, room occupants and
// the owner configuration form fixture. Pure data shaping, no emits.

import type { Bookmark, DataForm, MucOccupant, RosterItem } from '../stanzas'

import { CONTACTS, ROOM, ROOM_OCCUPANTS } from './fixtures'

export function demoRosterItems(): RosterItem[] {
  return CONTACTS.map((c) => ({ jid: c.jid, name: c.name, subscription: 'both', groups: [] }))
}

// seeded PEP bookmarks: the lobby room autojoins, a second room sits in
// the list waiting, and one contact bookmark shows the contact kind
export function demoBookmarks(): Bookmark[] {
  return [
    { jid: ROOM, kind: 'conference', name: 'Badinage lobby', autojoin: true, nick: 'you' },
    { jid: 'random@conference.badinage.local', kind: 'conference', name: 'Random' },
    { jid: 'aria@badinage.local', kind: 'contact', name: 'Aria' }
  ]
}

// the occupants a joined room pretends to have: our own self presence
// plus the fixed lobby cast. We join as owner/moderator so every
// moderation and configuration control is reachable in demo mode, and
// everyone carries a real jid plus an XEP-0421 occupant id because the
// demo room is non-anonymous.
export function roomOccupants(room: string, selfNick: string, selfJid = ''): MucOccupant[] {
  return [
    {
      room,
      nick: selfNick,
      presence: 'online',
      affiliation: 'owner',
      role: 'moderator',
      self: true,
      codes: ['110'],
      jid: selfJid || undefined,
      occupantId: 'occ-self'
    },
    ...ROOM_OCCUPANTS.map((o) => ({
      room,
      nick: o.nick,
      presence: 'online',
      affiliation: o.affiliation,
      role: o.role,
      self: false,
      codes: [] as string[],
      jid: `${o.nick}@badinage.local`,
      occupantId: `occ-${o.nick}`,
      avatarHash: `${o.nick}@badinage.local`
    }))
  ]
}

// XEP-0004 fixture for the owner configuration dialog: one field per
// rendered widget type so every branch of the generic form shows.
export function demoRoomConfig(): DataForm {
  return {
    title: 'Room configuration',
    instructions: 'Adjust how the lobby behaves.',
    fields: [
      {
        var: 'FORM_TYPE',
        type: 'hidden',
        required: false,
        values: ['http://jabber.org/protocol/muc#roomconfig'],
        options: []
      },
      {
        var: 'muc#roomconfig_roomname',
        type: 'text-single',
        label: 'Room name',
        required: false,
        values: ['Lobby'],
        options: []
      },
      {
        var: 'muc#roomconfig_roomdesc',
        type: 'text-single',
        label: 'Description',
        desc: 'Shown in room listings',
        required: false,
        values: ['Badinage lobby'],
        options: []
      },
      {
        var: 'muc#roomconfig_persistentroom',
        type: 'boolean',
        label: 'Persistent room',
        required: false,
        values: ['1'],
        options: []
      },
      {
        var: 'muc#roomconfig_membersonly',
        type: 'boolean',
        label: 'Members only',
        desc: 'Only members may join',
        required: false,
        values: ['0'],
        options: []
      },
      {
        var: 'muc#roomconfig_whois',
        type: 'list-single',
        label: 'Who can see real addresses',
        required: false,
        values: ['moderators'],
        options: [
          { value: 'moderators', label: 'Moderators only' },
          { value: 'anyone', label: 'Anyone' }
        ]
      },
      {
        var: 'muc#roomconfig_roomadmins',
        type: 'jid-multi',
        label: 'Room admins',
        required: false,
        values: ['cleo@badinage.local'],
        options: []
      }
    ]
  }
}
