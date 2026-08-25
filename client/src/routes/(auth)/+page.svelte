<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth.svelte';
  import { toast } from '$lib/toast.svelte';

  let email = $state('');
  let password = $state('');
  let submitting = $state(false);

  async function handleSubmit(event: Event): Promise<void> {
    event.preventDefault();
    submitting = true;

    const result = await api.post<string>('/login', { email, password });

    submitting = false;

    if (result.status === 400) {
      toast.error('Email must be valid format and password must be at least 8 characters');
    }

    if (result.status === 403) {
      if (result.data == `Bad Email`) {
        toast.error('Try new email.');
      } else if (result.data == `Bad Password`) {
        toast.error('Try new password.');
      }
      return;
    }

    if (!result.ok) {
      toast.error('Something went wrong');
      return;
    }

    auth.setUser(auth.user);
    await auth.refresh();

    toast.show(`${auth.user?.email} logged in.`);
    goto('/projects');
  }
</script>

<article>
  <h1>Log In</h1>

  <form onsubmit={handleSubmit}>
    <label>
      Email
      <input type="email" bind:value={email} required />
    </label>

    <label>
      Password
      <input type="password" bind:value={password} required />
    </label>

    <button type="submit" disabled={submitting}>
      {submitting ? 'Logging in...' : 'Log In'}
    </button>
  </form>
</article>
