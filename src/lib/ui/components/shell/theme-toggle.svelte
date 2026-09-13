<script lang="ts">
  import { Moon, Sun } from '@lucide/svelte'
  import { toggleMode } from 'mode-watcher'

  import LL from '$lib/i18n/i18n-svelte'
  import { Button } from '$lib/ui/primitives/button'
</script>

<Button variant="ghost" size="icon" onclick={toggleMode} aria-label={$LL.toggleTheme()}>
  <Sun class="scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
  <Moon class="absolute scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
</Button>
