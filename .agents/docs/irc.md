# IRC transport

Badinage supports IRC alongside XMPP. The target server is Ergo because
it is the only mainstream ircd with a native WebSocket listener, server
side history (draft/chathistory), and bouncer features (always-on
clients, multiclient) that approximate XMPP resumption and carbons.
The same code path also works against soju bouncers over WebSocket.

## Where things live

    src/lib/core/irc/
        line.ts          wire parser and serializer, casemapping
        address.ts       jid <-> irc target mapping, ISUPPORT, numerics
        session.ts       CAP negotiation and SASL PLAIN state machine
        transport.ts     WebSocket lifecycle, pings, reconnect backoff
        connection.ts    ChatConnection adapter, delegates everything
        outbound.ts      outbound commands plus IrcStubs no-op base
        inbound.ts       inbound line dispatch
        occupants.ts     channel membership tracking (Membership)
        mapping.ts       IrcLine -> ConnectionEvents conversion
        account-lists.ts monitor/bookmark/blocklist persistence
    src/lib/utils/irc.ts nick validation, kept out of core so ui can use it
    test/fake-irc-server.ts   scripted ircd for live unit tests
    docker/dev/ergo/ircd.yaml dev Ergo config

IrcConnection implements ChatConnection. XMPP only methods live in
IrcStubs as explicit no-ops so the class fits the file size limit.
TransportCapabilities on ChatConnection reports what the transport
supports; IRC declares e2ee, upload, profile, roomConfig, subscriptions
and registration unsupported, and Account.caps resolves the flags to
booleans the UI gates on.

## Addressing

Channels and nicks become synthetic jids: #chan@domain and nick@domain.
jidToTarget and targetToJid in address.ts do the conversion with the
server casemapping (rfc1459, strict-rfc1459, ascii) read from ISUPPORT.
Conversation keys, unread counts and storage scoping work unchanged.
The domain comes from the WebSocket URL hostname at login.

## Event mapping

PRIVMSG and TAGMSG become IncomingMessage (chat for nick targets,
groupchat for channels, CTCP ACTION as /me). JOIN, PART, QUIT, KICK,
NICK, MODE and NAMES become MucOccupant updates, TOPIC becomes the
subject. MONITOR and AWAY become PresenceUpdate, join failures become
PresenceError, INVITE becomes MucInvite, MARKREAD becomes readMarker,
CHATHISTORY batches become archive results. Self echoes are deduplicated
through labeled-response labels matched against locally pushed messages.

## Wire quirks that bite

- Ergo treats each WebSocket frame as exactly one IRC line. Never batch
  multiple CRLF separated lines into a single send.
- Ergo only advertises sasl on secure connections: TLS, loopback, or
  secure-nets. The dev config marks RFC1918 ranges secure because
  published ports NAT through the docker bridge and loopback never
  applies.
- Always-on clients keep their nickname after disconnecting. A new
  connection asking for a held nick gets 433; the session retries once
  with a _ suffix, then errors.
- SASL PLAIN is the only mechanism the client implements. Ergo also
  offers SCRAM and EXTERNAL when configured.

## Dev and interop

docker/dev/compose.yaml brings up ergo on 6667 (plain) and 8097
(websocket) with the config in docker/dev/ergo/ircd.yaml: registration
open and unthrottled, in-memory history, always-on opt-out.

Live tests:

- src/lib/core/irc/tests/connection.live.test.ts runs against the
  scripted fake ircd in test/ and needs no server.
- src/lib/core/irc/tests/ergo.live.test.ts runs against real Ergo when
  ERGO_WS is set:
  docker compose -f docker/dev/compose.yaml up -d ergo
  ERGO_WS=ws://localhost:8097 pnpm vitest run ergo.live
  It covers cap negotiation, NickServ registration + SASL, authfail,
  channel and DM relay, and server side chathistory. The ci.yml
  irc-interop job runs the same file against the compose service.

## Limitations

No E2EE, file upload, vCard profiles, presence subscriptions, MUC
configuration forms or in-band registration on IRC. Roster and
blocklist are local approximations backed by MONITOR and client side
lists. Edit and delete use unverified client tags, so they are best
effort. Nick changes on DM peers are not tracked as identity changes,
only occupant renames inside channels.
