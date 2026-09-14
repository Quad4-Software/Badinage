<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { Input } from '$lib/ui/primitives/input'
  import { Label } from '$lib/ui/primitives/label'

  // the credential fields shared by both protocol modes. identity is the
  // jid for xmpp and the nickname for irc. server is optional discovery
  // for xmpp and the required websocket url for irc. Validity is derived
  // by the parent, which needs it for the submit button
  let {
    protocol = $bindable(),
    identity = $bindable(),
    password = $bindable(),
    server = $bindable(),
    identityValid,
    serverValid,
    onprotocolchange
  }: {
    protocol: 'xmpp' | 'irc'
    identity: string
    password: string
    server: string
    identityValid: boolean
    serverValid: boolean
    onprotocolchange?: () => void
  } = $props()

  const isIrc = $derived(protocol === 'irc')
</script>

<div class="grid gap-2">
  <Label for="protocol">{$LL.protocol()}</Label>
  <select
    id="protocol"
    bind:value={protocol}
    onchange={onprotocolchange}
    class="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
  >
    <option value="xmpp">{$LL.protocolXmpp()}</option>
    <option value="irc">{$LL.protocolIrc()}</option>
  </select>
</div>

<div class="grid gap-2">
  <Label for="identity">{isIrc ? $LL.ircNick() : $LL.jid()}</Label>
  <Input
    id="identity"
    name="username"
    type="text"
    bind:value={identity}
    placeholder={isIrc ? $LL.ircNickPlaceholder() : $LL.jidPlaceholder()}
    autocomplete="username"
    aria-invalid={identity.length > 0 && !identityValid}
    required
  />
  <p class="text-muted-foreground text-xs">
    {isIrc ? $LL.ircNickHint() : $LL.jidHint()}
  </p>
</div>

<div class="grid gap-2">
  <Label for="password">{$LL.password()}</Label>
  <Input
    id="password"
    name="password"
    type="password"
    bind:value={password}
    autocomplete="current-password"
    required={!isIrc}
  />
  {#if isIrc}
    <p class="text-muted-foreground text-xs">{$LL.ircPasswordHint()}</p>
  {/if}
</div>

<div class="grid gap-2">
  <Label for="server">{$LL.server()}</Label>
  <Input
    id="server"
    name="server"
    type="url"
    bind:value={server}
    placeholder={$LL.serverPlaceholder()}
    aria-invalid={isIrc && server.length > 0 && !serverValid}
    required={isIrc}
  />
  <p class="text-muted-foreground text-xs">
    {isIrc ? $LL.ircServerHint() : $LL.serverHint()}
  </p>
</div>
