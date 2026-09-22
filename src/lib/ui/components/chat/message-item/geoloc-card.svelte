<script lang="ts">
  import { MapPin } from '@lucide/svelte'

  import { GEOLOC_TILE_TEMPLATE, GEOLOC_TILE_ZOOM } from '$lib/constants'
  import LL from '$lib/i18n/i18n-svelte'
  import type { ChatMessage } from '$lib/state/chats.svelte'
  import { settings } from '$lib/state/settings.svelte'
  import { cn } from '$lib/utils/cn'
  import { osmUrl, tileFor, tileUrl } from '$lib/utils/protocol/geo'

  let { message }: { message: ChatMessage } = $props()

  const geoloc = $derived(message.geoloc)
  const geoTile = $derived(geoloc ? tileFor(geoloc.lat, geoloc.lon, GEOLOC_TILE_ZOOM) : undefined)
  // the tile preview is opt-in because it fetches from a tile server
  const geoTileUrl = $derived(
    geoloc && settings.current.mapPreviews
      ? tileUrl(GEOLOC_TILE_TEMPLATE, geoloc.lat, geoloc.lon, GEOLOC_TILE_ZOOM)
      : ''
  )
</script>

{#if geoloc}
  <!-- XEP-0080: a location card linking out to openstreetmap -->
  <a
    href={osmUrl(geoloc.lat, geoloc.lon)}
    target="_blank"
    rel="noopener noreferrer"
    class={cn(
      'mb-1 block w-52 overflow-hidden rounded-md border text-left',
      message.outgoing ? 'border-primary-foreground/30' : 'border-border'
    )}
  >
    {#if geoTileUrl && geoTile}
      <span class="relative block h-28 w-52 overflow-hidden">
        <!-- tile is 256px. Offset it so the pin lands at the
             center of the 208x112 window -->
        <img
          src={geoTileUrl}
          alt=""
          class="absolute h-64 w-64 max-w-none"
          style:left="{104 - geoTile.pinX}px"
          style:top="{56 - geoTile.pinY}px"
        />
        <MapPin
          class="text-destructive absolute top-1/2 left-1/2 size-5 -translate-x-1/2 -translate-y-full"
        />
      </span>
    {/if}
    <span class="flex items-center gap-1.5 px-2 py-1.5 text-xs">
      <MapPin class="size-3.5 shrink-0" />
      <span class="min-w-0 flex-1 truncate">{$LL.sharedLocation()}</span>
      <span class="tabular-nums opacity-70">
        {geoloc.lat.toFixed(5)}, {geoloc.lon.toFixed(5)}
      </span>
    </span>
  </a>
{/if}
