// client/src/routes/admin/dashboard/+page.server.ts
/**import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, parent }) => {
  const { user } = await parent();
  const res = await fetch('/api/users/:userId/projects', {
    headers: {
      userId: user.userId,
    },
  });

  const projects = res.body;

  return {
    projects,
    // no need to return `user` again — it's already merged in automatically
  };
};*/
