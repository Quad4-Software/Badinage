import type { BaseTranslation } from '../i18n-types.js'

const en = {
  appName: 'Badinage',
  signIn: 'Sign in',
  signInTitle: 'Sign in to your XMPP account',
  jid: 'XMPP address',
  jidPlaceholder: 'you@example.org',
  password: 'Password',
  server: 'Server',
  serverPlaceholder: 'wss://example.org/xmpp-websocket',
  serverHint: 'Leave empty to discover the server automatically',
  rememberSession: 'Keep me signed in until I close this tab',
  connect: 'Connect',
  connecting: 'Connecting',
  authFailed: 'Authentication failed',
  connectionError: 'Could not reach the server',
  conversations: 'Conversations',
  contacts: 'Contacts',
  addAccount: 'Add account',
  removeAccount: 'Remove account',
  online: 'online',
  offline: 'offline',
  away: 'away',
  busy: 'busy',
  messagePlaceholder: 'Message {peer:string}',
  send: 'Send',
  noConversation: 'Select a conversation or contact to start chatting',
  emptyRoster: 'No contacts yet',
  toggleTheme: 'Toggle theme',
  back: 'Back',
  encrypted: 'Encrypted',
  notEncrypted: 'Not encrypted',
  unread: '{count:number} unread'
} satisfies BaseTranslation

export default en
