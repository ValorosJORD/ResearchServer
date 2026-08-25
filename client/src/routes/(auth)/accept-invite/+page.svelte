<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { api } from '$lib/api';
  import { onMount } from 'svelte';
  // adjust to wherever your api client actually lives
  import { toast } from '$lib/toast.svelte';

  type InviteCheckResponse = { email: string };
  type InviteErrorBody =
    | string
    | { formErrors: string[]; fieldErrors: Record<string, string[] | undefined> };

  let token = $state('');
  let email = $state('');
  let username = $state('');
  let name = $state('');
  let password = $state('');
  let confirmPassword = $state('');

  let status = $state<'checking' | 'valid' | 'invalid' | 'submitting'>('checking');
  let invalidMessage = $state('');

  function extractErrorMessage(data: InviteErrorBody | undefined, fallback: string): string {
    if (!data) return fallback;
    if (typeof data === 'string') return data;

    const fieldMessage = Object.values(data.fieldErrors ?? {})
      .flat()
      .find(Boolean);
    return fieldMessage ?? data.formErrors?.[0] ?? fallback;
  }

  onMount(async () => {
    token = $page.url.searchParams.get('token') ?? '';

    if (!token) {
      status = 'invalid';
      invalidMessage = 'No invite token provided.';
      return;
    }

    const res = await api.get<InviteErrorBody | InviteCheckResponse>(
      `/invites?token=${encodeURIComponent(token)}`,
    );

    if (!res.ok) {
      status = 'invalid';
      invalidMessage = extractErrorMessage(
        res.data as InviteErrorBody,
        'This invite link is invalid or has expired.',
      );
      return;
    }

    email = (res.data as InviteCheckResponse).email;
    status = 'valid';
  });

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (password.length < 8) {
      toast.error('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }

    status = 'submitting';

    const res = await api.post<InviteErrorBody>('/invites/accept', {
      token,
      username,
      name,
      password,
    });

    if (!res.ok) {
      toast.error(extractErrorMessage(res.data, 'Could not create your account.'));
      status = 'valid';
      return;
    }

    toast.success('Account created — welcome aboard!');
    await goto('/'); // adjust to wherever a logged-in user should land
  }
</script>

<main class="container">
  {#if status === 'checking'}
    <article aria-busy="true">Checking your invite…</article>
  {:else if status === 'invalid'}
    <article>
      <h1>Invite link invalid</h1>
      <p>{invalidMessage}</p>
      <p>Ask an admin to send you a new invite.</p>
    </article>
  {:else}
    <article>
      <hgroup>
        <h1>Create your account</h1>
        <p>Invited as <strong>{email}</strong></p>
      </hgroup>

      <form onsubmit={handleSubmit}>
        <label for="username">Username</label>
        <input
          id="username"
          type="text"
          bind:value={username}
          required
          disabled={status === 'submitting'}
        />

        <label for="name">Name</label>
        <input
          id="name"
          type="text"
          bind:value={name}
          required
          disabled={status === 'submitting'}
        />

        <label for="password">Password</label>
        <input
          id="password"
          type="password"
          bind:value={password}
          required
          minlength="8"
          disabled={status === 'submitting'}
        />

        <label for="confirmPassword">Confirm password</label>
        <input
          id="confirmPassword"
          type="password"
          bind:value={confirmPassword}
          required
          minlength="8"
          disabled={status === 'submitting'}
        />

        <button
          type="submit"
          aria-busy={status === 'submitting'}
          disabled={status === 'submitting'}
        >
          {status === 'submitting' ? 'Creating account' : 'Create account'}
        </button>
      </form>
    </article>
  {/if}
</main>
