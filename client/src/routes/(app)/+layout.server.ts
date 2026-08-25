// client/src/routes/admin/+layout.server.ts
import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export interface User {
  userId: string;
  email: string;
  username: string;
  name: string;
  role: `BANNED` | `AUTHORIZED` | `ADMIN`;
}

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

  const authenticatedUser: User = await res.json();

  if (authenticatedUser.role == 'BANNED') {
    console.log(authenticatedUser);
    throw error(403, 'Forbidden');
  }

  return { user: authenticatedUser };
};
