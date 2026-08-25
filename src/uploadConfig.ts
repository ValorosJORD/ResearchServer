import { ErrorRequestHandler } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';

// Single source of truth for where uploads live on disk. Both the write
// path (ProjectRoutes.ts) and the read path (FileRoutes.ts) resolve
// against this same root.
export const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
export const PROJECT_DIR = path.join(UPLOAD_ROOT, 'projects');
const MAX_FILE_SIZE = 512 * 1024 * 1024; // 512 MB

fs.mkdirSync(PROJECT_DIR, { recursive: true });
console.log(`[UploadConfig] Project files will be stored in: ${PROJECT_DIR}`);

// memoryStorage, not diskStorage — files must be encrypted before they
// touch the filesystem, so the controller needs the raw buffer in hand
// rather than multer writing plaintext straight to disk itself.
const uploadProjectFile = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
});

const uploadErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'File too large (max 512 MB)' });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }
  next(err); // not a multer error, pass it on
};

export { uploadErrorHandler, uploadProjectFile };
