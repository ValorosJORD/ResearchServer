import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

interface ProjectResponse {
  projectId: string;
  title: string;
  description: string;
  createdAt: string;
  lastEdited: string;
}

export const load: PageServerLoad = async ({ params, fetch }) => {
  const { projectId } = params;

  // Using the fetch passed into load (not global fetch) matters here: it's
  // the one that forwards the incoming request's session cookie and routes
  // through the dev proxy to the Express API correctly during SSR.
  const res = await fetch(`/api/projects/${projectId}`);

  if (res.status === 401) {
    redirect(303, '/login'); // adjust to your actual login route
  }

  // AccessProject distinguishes "doesn't exist" (404) from "exists but
  // you're not a member" (403) — both send a non-member back the same
  // place, since neither case is any of their business.
  if (res.status === 403 || res.status === 404) {
    redirect(303, '/projects'); // adjust to wherever your projects list lives
  }

  if (!res.ok) {
    // Anything else (500, etc.) isn't an access issue — surface it as a
    // real error page instead of silently redirecting.
    error(res.status, 'Could not load this project.');
  }

  const project: ProjectResponse = await res.json();

  return { project };
};
