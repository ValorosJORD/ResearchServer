import { z } from 'zod';

export const RegistrationSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(25),
  username: z.string().min(3).max(25),
  name: z.string().min(1).max(100).optional(),
});

export const LogInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(25),
});

export const UserIdSchema = z.object({
  userId: z.string(),
});
