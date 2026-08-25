import { z } from 'zod';

// Version-agnostic UUID shape. zod's built-in z.string().uuid() pins the
// version nibble to 1-5 in a lot of currently-shipped versions, which
// rejects legitimate uuidv7 values (version nibble 7) used throughout
// this app's entities.
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ProjectIdParamSchema = z.object({
  projectId: z.string().regex(uuidRegex, 'Invalid project ID'),
});

export const FileIdParamSchema = z.object({
  fileId: z.string().regex(uuidRegex, 'Invalid file ID'),
});
