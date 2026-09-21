<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { app } from '$lib/state/app.svelte'
  import LoginForm from '../login-form.svelte'
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
  } from '$lib/ui/primitives/dialog'
</script>

<Dialog bind:open={app.loginOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{$LL.addAccount()}</DialogTitle>
      <DialogDescription>{$LL.signInTitle()}</DialogDescription>
    </DialogHeader>
    <LoginForm embedded />
  </DialogContent>
</Dialog>
