// client/src/routes/admin/+layout.server.ts
import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ fetch, cookies }) => {
  const sessionCookie = cookies.get('session');

  if (!sessionCookie) {
    throw redirect(302, '/');
  }

  const res = await fetch('/api/me', {
    headers: {
      cookie: `session=${sessionCookie}`,
    },
  });

  if (res.status === 401) {
    throw redirect(302, '/');
  }

  if (!res.ok) {
    throw error(res.status, 'Failed to load session');
  }

  const authenticatedUser = await res.json();

  if (authenticatedUser.role !== 'ADMIN') {
    console.log(authenticatedUser);
    throw error(403, 'Forbidden');
  }

  return { user: authenticatedUser };
};
