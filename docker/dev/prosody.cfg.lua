-- Minimal Prosody config for local development of Badinage.
-- Not for production use.

admins = {}
modules_enabled = {
  "roster",
  "saslauth",
  "tls",
  "disco",
  "carbons",
  "pep",
  "private",
  "blocklist",
  "vcard4",
  "vcard_legacy",
  "version",
  "uptime",
  "time",
  "ping",
  "register",
  "mam",
  "smacks",
  "websocket",
  "bosh",
  "http_file_share",
  "bookmarks"
}
modules_disabled = {}

allow_registration = true
c2s_require_encryption = false
consider_websocket_secure = true
consider_bosh_secure = true
cross_domain_websocket = true
cross_domain_bosh = true

http_ports = { 5280 }
http_interfaces = { "*" }
https_ports = {}

VirtualHost "localhost"
  authentication = "internal_hashed"

Component "conference.localhost" "muc"
  name = "Badinage dev rooms"
  restrict_room_creation = false

Component "upload.localhost" "http_file_share"
