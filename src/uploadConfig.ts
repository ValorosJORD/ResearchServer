import { ErrorRequestHandler, Request } from 'express';
import fs from 'fs';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';

export const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
export const PROJECT_DIR = path.join(UPLOAD_ROOT, 'projects');
const MAX_FILE_SIZE = 512 * 1024 * 1024; // 512 MB

fs.mkdirSync(PROJECT_DIR, { recursive: true });
console.log(`[UploadConfig] Project files will be stored in: ${PROJECT_DIR}`);

const ALLOWED_EXTENSIONS = new Set(['.dex', '.apk']);

// Checked server-side against the actual uploaded file's own name — this
// isn't a client-trusted value, so it's a real gate, not just UX. (It's
// still just an extension check, not content sniffing — a renamed file
// would pass this and then simply fail classification downstream instead.)
class UnsupportedFileTypeError extends Error {
  constructor(filename: string) {
    super(`${filename}: only .dex and .apk files are accepted`);
    this.name = 'UnsupportedFileTypeError';
  }
}

function fileFilter(req: Request, file: Express.Multer.File, cb: FileFilterCallback): void {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    cb(new UnsupportedFileTypeError(file.originalname));
    return;
  }
  cb(null, true);
}

// memoryStorage, not diskStorage — files are encrypted before they touch
// the filesystem, and the plaintext buffer is also what gets classified,
// so the controller needs the raw buffer in hand either way.
const uploadProjectFile = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
});

const uploadErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (err instanceof UnsupportedFileTypeError) {
    res.status(400).json({ error: err.message });
    return;
  }
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
