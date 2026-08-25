<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth.svelte';
  import { toast } from '$lib/toast.svelte';
  import { onMount } from 'svelte';

  interface Project {
    projectId: string;
    title: string;
    description: string;
    createdAt: Date;
    lastEdited: Date;
  }

  import Modal from '$lib/components/Modal.svelte';

  let isOpen = $state(false);

  let projects: Project[] = $state([]);
  let loading = $state(true);

  onMount(async () => {
    await auth.refresh();
    const userId = auth.user?.userId;

    const result = await api.get<Project[]>(`/users/${userId}/projects`);

    if (result.ok) {
      projects = result.data;
      projects.sort((a, b) => {
        const dateA = new Date(a.createdAt);
        const dateB = new Date(b.createdAt);

        return dateB.getTime() - dateA.getTime();
      });
    }

    loading = false;
  });

  let title = $state('');
  let description = $state('');
  let submitting = $state(false);

  async function handleSubmit(event: Event): Promise<void> {
    event.preventDefault();
    submitting = true;

    await auth.refresh();
    const userId = auth.user?.userId;

    const result = await api.post<Project>(`/projects`, {
      title,
      description,
      userId,
    });

    submitting = false;

    if (result.status === 401) {
      toast.show('Please log in to continue', 'error');
      goto('/login');
      return;
    }

    if (!result.ok) {
      toast.show('Failed to create project', 'error');
      return;
    }

    const { projectId } = result.data;

    toast.show('Item created!', 'success');
    goto(`/projects/${projectId}`);
  }
</script>

<Modal bind:open={isOpen} title="Project Creation">
  <form onsubmit={handleSubmit}>
    <label>
      Title
      <input type="text" bind:value={title} required />
    </label>

    <label>
      Description
      <textarea bind:value={description}></textarea>
    </label>

    <button type="submit" disabled={submitting}>
      {submitting ? 'Creating...' : 'Create Project'}
    </button>
  </form>
</Modal>

<article style="max-width: fit-content; margin-inline: auto;">
  <h3>Interested in creating a project?</h3>
  <button onclick={() => (isOpen = true)}>Create your own project now!</button>
</article>

{#if loading}
  <loading></loading>
{:else if projects.length === 0}
  <p>No Projects</p>
{:else}
  <ul>
    {#each projects as project (project.projectId)}
      <li style="list-style-type: none;">
        <article>
          <a href="/projects/{project.projectId}">
            <h1 class="contrast-text">
              <strong>{project.title}</strong>
            </h1>
          </a>
          <p>{project.description}</p>
        </article>
      </li>
    {/each}
  </ul>
{/if}
