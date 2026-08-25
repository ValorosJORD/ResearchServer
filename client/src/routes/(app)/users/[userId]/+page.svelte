<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth.svelte';
  import { onMount } from 'svelte';

  interface User {
    userId: string;
    email: string;
    verifiedEmail: boolean;
    username: string;
    name: string;
    createdAt: Date;
  }

  let user: User | null = $state(null);
  let loading = $state(true);

  let date = $state();
  let time = $state();

  onMount(async () => {
    const id = page.params.userId;
    const result = await api.get<User>(`/users/${id}`);

    console.log(result.data);

    if (result.ok) {
      user = result.data;

      const createdAt = new Date(user.createdAt);

      date = createdAt.toDateString();
      time = createdAt.toTimeString();
    }

    loading = false;
  });

  async function logOut(): Promise<void> {
    api.del('/sessions');
    goto('/');
    await auth.refresh();
  }
</script>

{#if loading}
  <loading></loading>
{:else if !user}
  <p>User Account not found.</p>
{:else}
  <article>
    <h1>{user.username}</h1>
    <h2>{user.name}</h2>
    <p><strong>Email:</strong> {user.email}</p>
    <p>Account created <strong>{date}</strong> <em>at</em> <strong>{time}</strong></p>
    <p><strong>UUID:</strong> {user.userId}</p>
    <button onclick={logOut}>Log Out</button>
  </article>
{/if}
