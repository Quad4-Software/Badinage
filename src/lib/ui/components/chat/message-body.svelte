<script lang="ts">
  // XEP-0393 message styling renderer: maps the token tree from
  // utils/message-styling to real elements. Nothing here builds HTML
  // strings. Text always goes through svelte interpolation.
  import { tokenizeStyling, type BlockToken, type SpanToken } from '$lib/utils/message-styling'

  let { body, unstyled = false }: { body: string; unstyled?: boolean | undefined } = $props()

  const URL_RE = /(https?:\/\/\S+)/g
  const isUrl = (part: string) => /^https?:\/\/\S+$/.test(part)

  // a sender opt-out renders the body as one literal line block
  const blocks = $derived<BlockToken[]>(
    unstyled ? [{ type: 'line', spans: [{ type: 'text', text: body }] }] : tokenizeStyling(body)
  )
</script>

{#snippet renderText(text: string)}
  {#each text.split(URL_RE) as part, i (i)}
    {#if isUrl(part)}
      <a href={part} target="_blank" rel="noopener noreferrer" class="underline underline-offset-2"
        >{part}</a
      >
    {:else}{part}{/if}
  {/each}
{/snippet}

{#snippet renderSpans(spans: SpanToken[])}
  {#each spans as span, i (i)}
    {#if span.type === 'text'}
      {@render renderText(span.text)}
    {:else if span.type === 'code'}
      <code class="bg-foreground/10 rounded px-1 py-0.5 font-mono text-[0.85em]">{span.text}</code>
    {:else if span.type === 'strong'}
      <strong>{@render renderSpans(span.children)}</strong>
    {:else if span.type === 'emphasis'}
      <em>{@render renderSpans(span.children)}</em>
    {:else if span.type === 'strike'}
      <s>{@render renderSpans(span.children)}</s>
    {/if}
  {/each}
{/snippet}

{#snippet renderBlocks(list: BlockToken[])}
  {#each list as block, i (i)}
    {#if block.type === 'pre'}
      <pre
        class="bg-foreground/10 my-1 overflow-x-auto rounded-md p-2 font-mono text-[0.85em] whitespace-pre-wrap"><code
          >{block.text}</code
        ></pre>
    {:else if block.type === 'quote'}
      <blockquote class="border-foreground/30 my-0.5 border-l-2 pl-2">
        {@render renderBlocks(block.children)}
      </blockquote>
    {:else}
      <span class="block whitespace-pre-wrap">{@render renderSpans(block.spans)}</span>
    {/if}
  {/each}
{/snippet}

<div class="min-w-0 break-words">{@render renderBlocks(blocks)}</div>
