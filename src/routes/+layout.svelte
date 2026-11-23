<script>
  import '../app.css';
  import { onMount } from 'svelte';
  import { app } from '$lib/db/store.svelte.js';
  let { children } = $props();

  onMount(() => {
    app.initVault();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (reduce?.matches) app.reducedMotion = true;
  });
</script>

{@render children()}
