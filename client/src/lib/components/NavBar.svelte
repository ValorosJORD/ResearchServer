<script lang="ts">
  import { auth } from '$lib/auth.svelte';

  let id = $state();

  async function accountClicked(): Promise<void> {
    if (auth.user) {
      id = auth.user.userId;
    }
  }
</script>

<nav class="navbar">
  <ul>
    <li>
      <a href="/projects" class="contrast-text link">
        <strong> Projects </strong>
      </a>
    </li>
  </ul>
  <ul>
    <li>
      <strong>
        <a onclick={accountClicked} href="/users/{id}" class="contrast-text link">Account</a>
      </strong>
    </li>
  </ul>
</nav>

<style>
  .navbar {
    width: 100%;
    background-color: var(--pico-primary);
    padding-left: 1.5rem;
    padding-right: 1.5rem;
  }

  .contrast-text {
    color: var(--pico-primary-inverse);
  }

  .link {
    transition: 0.25s;
  }

  .link:hover {
    transform: scale(1.1);
    transition: 0.25s;
  }
</style>
