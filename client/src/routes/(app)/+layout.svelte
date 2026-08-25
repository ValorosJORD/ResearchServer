<script lang="ts">
  import NavBar from '$lib/components/NavBar.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import '../../app.css';

  let { children } = $props();
</script>

<header>
  <NavBar />
</header>

<main class="container">
  {@render children()}
</main>
<Toast />

<style>
</style>
