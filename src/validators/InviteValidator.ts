import { z } from 'zod';

export const CreateInviteSchema = z.object({
  email: z.string().email(),
  // Deliberately excludes 'BANNED' — you invite someone in, you don't invite them banned.
  role: z.enum(['AUTHORIZED', 'ADMIN']).default('AUTHORIZED'),
});

export const CheckInviteSchema = z.object({
  token: z.string().length(64),
});

export const AcceptInviteSchema = z.object({
  token: z.string().length(64),
  password: z.string().min(8),
  username: z.string().min(1),
  name: z.string().min(1),
});
