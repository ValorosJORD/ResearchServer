<script lang="ts">
  import { api } from '$lib/api';
  import { onMount } from 'svelte';
  // adjust to wherever your api client actually lives

  type InviteErrorBody =
    | string
    | { formErrors: string[]; fieldErrors: Record<string, string[] | undefined> };

  interface MeResponse {
    userId: string;
    email: string;
    username: string;
    name: string;
    role: 'BANNED' | 'AUTHORIZED' | 'ADMIN';
  }

  let authStatus: 'checking' | 'authorized' | 'unauthorized' = 'checking';

  onMount(async () => {
    // /api/me returns 401 if not logged in at all, or the session's user
    // (including role) if logged in — either way this is just UX: the
    // real gate is the 403 CreateUserInvite already returns server-side.
    const res = await api.get<MeResponse>('/me');
    authStatus = res.ok && res.data?.role === 'ADMIN' ? 'authorized' : 'unauthorized';
  });

  let email = '';
  let role: 'AUTHORIZED' | 'ADMIN' = 'AUTHORIZED';

  let status: 'idle' | 'submitting' | 'error' = 'idle';
  let errorMessage = '';
  let sentTo: string[] = []; // running list, since admins will likely send several in a row

  function extractErrorMessage(data: InviteErrorBody | undefined): string {
    if (!data) return 'Something went wrong sending the invite.';
    if (typeof data === 'string') return data;

    const fieldMessage = Object.values(data.fieldErrors ?? {})
      .flat()
      .find(Boolean);
    return fieldMessage ?? data.formErrors?.[0] ?? 'Invalid invite details.';
  }

  async function handleSubmit() {
    errorMessage = '';
    status = 'submitting';

    const res = await api.post<InviteErrorBody>('/invites', { email, role });

    if (!res.ok) {
      errorMessage = extractErrorMessage(res.data);
      status = 'error';
      return;
    }

    sentTo = [email, ...sentTo];
    email = '';
    role = 'AUTHORIZED';
    status = 'idle';
  }
</script>

<main class="container">
  {#if authStatus === 'checking'}
    <article aria-busy="true">Checking access…</article>
  {:else if authStatus === 'unauthorized'}
    <article>
      <h1>Unauthorized</h1>
      <p>You don't have access to this page.</p>
    </article>
  {:else}
    <article>
      <hgroup>
        <h1>Invite a new user</h1>
        <p>
          They'll get an email with a link to set up their account. This is the only way new
          accounts get created.
        </p>
      </hgroup>

      <form on:submit|preventDefault={handleSubmit}>
        <label for="email">Email</label>
        <input
          id="email"
          type="email"
          bind:value={email}
          required
          placeholder="person@example.com"
          disabled={status === 'submitting'}
          aria-invalid={errorMessage ? true : undefined}
        />

        <label for="role">Role</label>
        <select id="role" bind:value={role} disabled={status === 'submitting'}>
          <option value="AUTHORIZED">Authorized</option>
          <option value="ADMIN">Admin</option>
        </select>

        {#if errorMessage}
          <small class="error">{errorMessage}</small>
        {/if}

        <button
          type="submit"
          aria-busy={status === 'submitting'}
          disabled={status === 'submitting'}
        >
          {status === 'submitting' ? 'Sending' : 'Send invite'}
        </button>
      </form>
    </article>

    {#if sentTo.length > 0}
      <article>
        <h2>Sent this session</h2>
        <ul>
          {#each sentTo as sentEmail}
            <li>{sentEmail}</li>
          {/each}
        </ul>
      </article>
    {/if}
  {/if}
</main>

<style>
  /* Pico handles color via data-theme / prefers-color-scheme, so we use its
     built-in --pico-del-color for error text instead of hardcoding a hex. */
  .error {
    color: var(--pico-del-color);
    display: block;
    margin-bottom: 1rem;
  }
</style>
