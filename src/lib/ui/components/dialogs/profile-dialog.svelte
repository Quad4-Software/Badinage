<script lang="ts">
  import { ImagePlus, Trash2 } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { fetchProfile, saveProfile } from '$lib/state/accounts/profile'
  import { app } from '$lib/state/app.svelte'
  import { fileToAvatar } from '$lib/ui/avatar-file'
  import { Avatar, AvatarFallback, AvatarImage } from '$lib/ui/primitives/avatar'
  import { Button } from '$lib/ui/primitives/button'
  import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
  } from '$lib/ui/primitives/dialog'
  import { Input } from '$lib/ui/primitives/input'
  import { Label } from '$lib/ui/primitives/label'
  import { toast } from '$lib/ui/primitives/sonner'

  const account = $derived(accounts.active)

  let fn = $state('')
  let nickname = $state('')
  let desc = $state('')
  let photo = $state<string | undefined>(undefined)
  let saving = $state(false)
  let fileInput = $state<HTMLInputElement | null>(null)

  // every open re-fetches the stored card so the fields show the
  // server-side truth, not the last edit
  $effect(() => {
    if (!app.profileOpen) return
    const acc = account
    if (!acc || !acc.caps.profile) return
    fn = ''
    nickname = ''
    desc = ''
    photo = undefined
    fetchProfile(acc, (vcard) => {
      if (!vcard) return
      fn = vcard.fn
      nickname = vcard.nickname
      desc = vcard.desc
      photo = vcard.photoUri
    })
  })

  async function pick(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const uri = await fileToAvatar(file)
    if (uri) photo = uri
    else toast.error($LL.avatarReadFailed())
  }

  function publish() {
    const acc = account
    if (!acc || saving) return
    saving = true
    const vcard = {
      fn: fn.trim(),
      nickname: nickname.trim(),
      desc: desc.trim(),
      photoUri: photo
    }
    saveProfile(acc, vcard, (ok) => {
      saving = false
      if (!ok) {
        toast.error($LL.profilePublishFailed())
        return
      }
      toast.success($LL.profilePublished())
      app.profileOpen = false
    })
  }
</script>

<Dialog bind:open={app.profileOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{$LL.editProfile()}</DialogTitle>
    </DialogHeader>
    {#if account && !account.caps.profile}
      <p class="text-muted-foreground text-sm">{$LL.profileUnsupported()}</p>
    {:else if account}
      <form
        class="flex flex-col gap-4"
        onsubmit={(event) => {
          event.preventDefault()
          publish()
        }}
      >
        <div class="flex items-center gap-4">
          <Avatar class="size-16">
            {#if photo}
              <AvatarImage src={photo} alt="" />
            {/if}
            <AvatarFallback class="text-lg">
              {(nickname || account.jid).slice(0, 2)}
            </AvatarFallback>
          </Avatar>
          <div class="flex flex-col gap-1.5">
            <Button type="button" variant="outline" size="sm" onclick={() => fileInput?.click()}>
              <ImagePlus class="size-4" />
              {$LL.changeAvatar()}
            </Button>
            {#if photo}
              <Button type="button" variant="ghost" size="sm" onclick={() => (photo = undefined)}>
                <Trash2 class="size-4" />
                {$LL.removeAvatar()}
              </Button>
            {/if}
            <input
              bind:this={fileInput}
              type="file"
              accept="image/*"
              class="hidden"
              tabindex={-1}
              aria-label={$LL.avatar()}
              onchange={pick}
            />
          </div>
        </div>
        <div class="grid gap-2">
          <Label for="profile-fn">{$LL.fullName()}</Label>
          <Input id="profile-fn" bind:value={fn} autocomplete="name" />
        </div>
        <div class="grid gap-2">
          <Label for="profile-nick">{$LL.nickname()}</Label>
          <Input id="profile-nick" bind:value={nickname} />
        </div>
        <div class="grid gap-2">
          <Label for="profile-desc">{$LL.about()}</Label>
          <textarea
            id="profile-desc"
            bind:value={desc}
            rows="3"
            class="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex min-h-16 w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
          ></textarea>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onclick={() => (app.profileOpen = false)}>
            {$LL.cancel()}
          </Button>
          <Button type="submit" disabled={saving}>{$LL.publish()}</Button>
        </DialogFooter>
      </form>
    {/if}
  </DialogContent>
</Dialog>
