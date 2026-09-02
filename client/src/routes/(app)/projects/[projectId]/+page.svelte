<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { api } from '$lib/api';
  // adjust to wherever your api client actually lives
  import FileUpload from '$lib/components/FileUpload.svelte';
  import Modal from '$lib/components/Modal.svelte';
  // adjust to wherever your modal component lives
  import { toast } from '$lib/toast.svelte';
  import { formatBytes, uploadFiles, type UploadError } from '$lib/upload';

  // This file IS the +page.svelte for /projects/[projectId], so the ID
  // comes straight from the route params, not a prop from a parent.
  // $derived (rather than a plain const) so it stays correct if you
  // navigate directly from one /projects/[projectId] URL to another —
  // SvelteKit reuses this component instance rather than remounting it.
  let projectId = $derived($page.params.projectId);

  interface ProjectFile {
    fileId: string;
    fileSize: number;
    originalName: string;
    mimeType: string;
    createdAt: string;
    classification: {
      predictedLabel: string;
      confidence: number;
      perClass: Record<string, number>;
    } | null;
  }

  type ErrorBody =
    | string
    | { formErrors: string[]; fieldErrors: Record<string, string[] | undefined> };

  const MAX_FILE_SIZE = 512 * 1024 * 1024; // matches the server's multer limit
  const ACCEPTED_TYPES = '.dex,.apk';

  let projectFiles = $state<ProjectFile[]>([]);
  let loadingFiles = $state(true);

  let selectedFiles = $state<File[]>([]);
  let uploading = $state(false);
  let progress = $state(0);

  let fileToDelete = $state<ProjectFile | null>(null);
  let deleteModalOpen = $state(false);
  let deleting = $state(false);

  let newMemberEmail = $state('');
  let addingMember = $state(false);

  function extractErrorMessage(data: ErrorBody | undefined, fallback: string): string {
    if (!data) return fallback;
    if (typeof data === 'string') return data;

    const fieldMessage = Object.values(data.fieldErrors ?? {})
      .flat()
      .find(Boolean);
    return fieldMessage ?? data.formErrors?.[0] ?? fallback;
  }

  function extractUploadErrorMessage(err: unknown): string {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return 'Upload cancelled.';
    }

    const uploadErr = err as UploadError;

    // Prefer whatever the server actually said, if it's parseable JSON —
    // that distinguishes a real 404 from our own controller (project
    // genuinely not found) from an unmatched route hitting Express's
    // default (non-JSON) 404 page.
    if (uploadErr?.response) {
      try {
        const parsed = JSON.parse(uploadErr.response) as ErrorBody;
        return extractErrorMessage(parsed, uploadErr.message);
      } catch {
        // Not JSON — fall through to the status-based messages below.
      }
    }

    if (uploadErr?.status === 401) return 'You need to be logged in to upload files.';
    if (uploadErr?.status === 403) return "You don't have access to upload to this project.";
    if (uploadErr?.status === 413) return 'One of those files is larger than the 512 MB limit.';
    if (uploadErr?.status === 404) return 'This project no longer exists.';

    return uploadErr?.message ?? 'Something went wrong uploading files.';
  }

  async function loadFiles(): Promise<void> {
    loadingFiles = true;
    const res = await api.get<ProjectFile[] | ErrorBody>(`/projects/${projectId}/files`);
    loadingFiles = false;

    if (!res.ok) {
      // ListProjectFiles returns 403 for both "not a member" and "project
      // doesn't exist" (it never distinguishes the two, so a non-member
      // can't tell which by probing). Either way, they don't belong here.
      if (res.status === 403) {
        toast.error("You don't have access to that project.");
        await goto('/projects'); // adjust to wherever your projects list actually lives
        return;
      }

      if (res.status === 401) {
        await goto('/login'); // adjust to your actual login route
        return;
      }

      toast.error(extractErrorMessage(res.data as ErrorBody, 'Could not load project files.'));
      return;
    }

    projectFiles = res.data as ProjectFile[];
  }

  // Refetches whenever the route's projectId actually changes — covers
  // both the first load and navigating directly between two projects.
  $effect(() => {
    selectedFiles = [];
    loadFiles();
  });

  async function handleUpload(): Promise<void> {
    if (selectedFiles.length === 0) return;

    uploading = true;
    progress = 0;

    try {
      const uploaded = await uploadFiles<ProjectFile[]>(
        `/projects/${projectId}/files`,
        selectedFiles,
        {
          fieldName: 'files', // must match uploadProjectFile.array('files') on the server
          onProgress: (percent) => {
            // Only reflects the upload transfer itself — classification
            // runs after the transfer completes, with no progress signal
            // of its own, so the button switches to a static "waiting on
            // classification" message once the transfer hits 100%.
            progress = percent;
          },
        },
      );

      projectFiles = [...uploaded, ...projectFiles];
      selectedFiles = [];
      toast.success(`Classified ${uploaded[0].originalName}.`);
    } catch (err) {
      toast.error(extractUploadErrorMessage(err));
    } finally {
      uploading = false;
      progress = 0;
    }
  }

  function handleDropzoneError(message: string): void {
    toast.error(message);
  }

  function promptDelete(file: ProjectFile): void {
    fileToDelete = file;
    deleteModalOpen = true;
  }

  async function confirmDelete(): Promise<void> {
    if (!fileToDelete) return;

    deleting = true;
    const res = await api.del<ErrorBody>(`/files/${fileToDelete.fileId}`);
    deleting = false;

    if (!res.ok) {
      toast.error(extractErrorMessage(res.data as ErrorBody, 'Could not delete file.'));
      return;
    }

    projectFiles = projectFiles.filter((f) => f.fileId !== fileToDelete!.fileId);
    toast.success(`Deleted ${fileToDelete.originalName}.`);
    deleteModalOpen = false;
    fileToDelete = null;
  }

  async function handleAddMember(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!newMemberEmail) return;

    addingMember = true;
    const res = await api.post<ErrorBody>(`/projects/${projectId}/users`, {
      email: newMemberEmail,
    });
    addingMember = false;

    if (!res.ok) {
      toast.error(extractErrorMessage(res.data, 'Could not add that user.'));
      return;
    }

    toast.success(`Added ${newMemberEmail} to the project.`);
    newMemberEmail = '';
  }
</script>

<section>
  <h2>Members</h2>
  <form onsubmit={handleAddMember}>
    <label for="memberEmail">Add a user by email</label>
    <div role="group">
      <input
        id="memberEmail"
        type="email"
        bind:value={newMemberEmail}
        required
        placeholder="person@example.com"
        disabled={addingMember}
      />
      <button type="submit" aria-busy={addingMember} disabled={addingMember}>
        {addingMember ? 'Adding' : 'Add'}
      </button>
    </div>
  </form>
</section>

<section>
  <h2>Files</h2>
  <p><small>Only .dex and .apk files are accepted — each one is classified on upload.</small></p>

  <FileUpload
    bind:files={selectedFiles}
    accept={ACCEPTED_TYPES}
    maxSize={MAX_FILE_SIZE}
    disabled={uploading}
    onError={handleDropzoneError}
  />

  {#if selectedFiles.length > 0}
    <button type="button" onclick={handleUpload} disabled={uploading} aria-busy={uploading}>
      {#if !uploading}
        Upload &amp; classify
      {:else if progress < 100}
        Uploading {progress}%
      {:else}
        Running classification… this can take a few minutes
      {/if}
    </button>
  {/if}

  {#if loadingFiles}
    <p aria-busy="true">Loading files…</p>
  {:else if projectFiles.length === 0}
    <p><em>No files uploaded yet.</em></p>
  {:else}
    <table>
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Classification</th>
          <th scope="col">Size</th>
          <th scope="col">Uploaded</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each projectFiles as file (file.fileId)}
          <tr>
            <td>{file.originalName}</td>
            <td>
              {#if file.classification}
                <strong>{file.classification.predictedLabel}</strong>
                <br />
                <small>{(file.classification.confidence * 100).toFixed(1)}% confidence</small>
              {:else}
                <small><em>Not classified (uploaded before this feature)</em></small>
              {/if}
            </td>
            <td>{formatBytes(file.fileSize)}</td>
            <td>{new Date(file.createdAt).toLocaleDateString()}</td>
            <td>
              <a href={`/api/files/${file.fileId}`} download={file.originalName}>Download</a>
              <button type="button" class="secondary" onclick={() => promptDelete(file)}>
                Delete
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<Modal bind:open={deleteModalOpen} title="Delete file?">
  <p>
    <strong>{fileToDelete?.originalName}</strong> will be permanently deleted. This can't be undone.
  </p>
  <footer>
    <button type="button" class="secondary" onclick={() => (deleteModalOpen = false)}>
      Cancel
    </button>
    <button type="button" onclick={confirmDelete} aria-busy={deleting} disabled={deleting}>
      {deleting ? 'Deleting' : 'Delete'}
    </button>
  </footer>
</Modal>
