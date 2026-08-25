<script lang="ts">
  import Toast from '$lib/components/Toast.svelte';
  import '../../app.css';

  let { children } = $props();
</script>

<main class="container">
  {@render children()}
</main>
<Toast />

<style>
</style>
