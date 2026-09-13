<script lang="ts">
  // the scrubbed-report disclosure shared by the consent prompt and the
  // privacy settings row
  import LL from '$lib/i18n/i18n-svelte'
  import { SAMPLE_REPORT } from '$lib/ui/sample-report'
</script>

<details class="text-xs">
  <summary
    class="text-primary cursor-pointer font-medium select-none [&::-webkit-details-marker]:hidden"
  >
    {$LL.crashPromptSample()}
  </summary>
  <pre
    class="bg-muted text-muted-foreground mt-2 max-h-48 overflow-auto rounded-md p-3 text-[11px] leading-snug break-all whitespace-pre-wrap">{SAMPLE_REPORT}</pre>
</details>
