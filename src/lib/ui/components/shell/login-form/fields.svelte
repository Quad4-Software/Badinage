<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { Checkbox } from '$lib/ui/primitives/checkbox'
  import { Input } from '$lib/ui/primitives/input'
  import { Label } from '$lib/ui/primitives/label'

  // the credential fields shared by both protocol modes. identity is the
  // jid for xmpp, the nickname for irc, and just the server domain for an
  // anonymous xmpp login. server is optional discovery for xmpp and the
  // required websocket url for irc. Validity is derived by the parent,
  // which needs it for the submit button
  let {
    protocol = $bindable(),
    identity = $bindable(),
    password = $bindable(),
    server = $bindable(),
    anonymous = $bindable(),
    useToken = $bindable(),
    identityValid,
    serverValid,
    onprotocolchange
  }: {
    protocol: 'xmpp' | 'irc'
    identity: string
    password: string
    server: string
    anonymous: boolean
    useToken: boolean
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
  <Label for="identity"
    >{isIrc ? $LL.ircNick() : anonymous ? $LL.anonymousDomain() : $LL.jid()}</Label
  >
  <Input
    id="identity"
    name="username"
    type="text"
    bind:value={identity}
    placeholder={isIrc
      ? $LL.ircNickPlaceholder()
      : anonymous
        ? $LL.anonymousDomainPlaceholder()
        : $LL.jidPlaceholder()}
    autocomplete="username"
    aria-invalid={identity.length > 0 && !identityValid}
    required
  />
  <p class="text-muted-foreground text-xs">
    {isIrc ? $LL.ircNickHint() : anonymous ? $LL.anonymousDomainHint() : $LL.jidHint()}
  </p>
</div>

{#if !anonymous}
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
{/if}

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

{#if isIrc}
  <label class="flex items-center gap-2 text-sm">
    <Checkbox id="use-token" bind:checked={useToken} />
    {$LL.accessTokenLogin()}
  </label>
{:else}
  <label class="flex items-center gap-2 text-sm">
    <Checkbox id="anonymous" bind:checked={anonymous} />
    {$LL.anonymousLogin()}
  </label>
{/if}
