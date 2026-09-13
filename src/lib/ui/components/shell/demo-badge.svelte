<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
</script>

<!-- static badge, tucked into the top edge so it reads as attached
  chrome; role=status makes it a landmark so axe's region rule does not
  flag it as content floating outside the page structure -->
<div
  role="status"
  class="bg-primary text-primary-foreground pointer-events-none fixed top-0 left-1/2 z-40 -translate-x-1/2 rounded-b-md px-3 py-1 text-[0.65rem] font-bold tracking-widest uppercase"
>
  {$LL.demoBadge()}
</div>
