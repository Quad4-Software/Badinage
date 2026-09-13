<script lang="ts">
  // renders the pending one-time prompt by id. New asks register a
  // PromptDef in prompts.svelte.ts and get a branch here
  import { currentPrompt } from '$lib/state/app/prompts.svelte'

  import CrashReportPrompt from './crash-report-prompt.svelte'
</script>

{#if currentPrompt()?.id === 'crash-reporting'}
  <CrashReportPrompt />
{/if}
