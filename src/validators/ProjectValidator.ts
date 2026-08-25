import { z } from 'zod';

export const ProjectCreationSchema = z.object({
  title: z.string().min(3).max(100),
  description: z.string().max(1000).optional(),
  userId: z.string(),
});

export const ProjectIdSchema = z.object({
  projectId: z.string(),
});

export const FileBodySchema = z.object({
  caption: z.string().max(200).optional(),
});

export const AddProjectUserSchema = z.object({
  email: z.string().email(),
});
