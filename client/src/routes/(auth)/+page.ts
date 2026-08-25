import { auth } from '$lib/auth.svelte';
import { redirect, type Load } from '@sveltejs/kit';

export const ssr = false;

export const load: Load = async ({ parent }) => {
  // Waits for (auth)/+layout.ts's auth.refresh() to actually finish before
  // checking isLoggedIn — without this, this load can run concurrently
  // with the layout's and see stale (not-yet-refreshed) auth state.
  await parent();

  if (auth.isLoggedIn) {
    redirect(303, '/projects');
  }

  return {};
};
