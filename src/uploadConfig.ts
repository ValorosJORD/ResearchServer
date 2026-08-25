import { ErrorRequestHandler } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { v7 as uuidv7 } from 'uuid';

// Single source of truth for where uploads live on disk. Both the write
// path (here) and the read path (FileRoutes.ts) resolve against this same
// root, so a relative path stored in the DB always means the same thing
// regardless of the process's current working directory at request time.
export const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
const PROJECT_DIR = path.join(UPLOAD_ROOT, 'projects');
const MAX_FILE_SIZE = 512 * 1024 * 1024; // 512 MB
/*const ALLOWED_MIME_TYPES = ['audio/mpeg', 'audio/wav'];*/

// multer's diskStorage does NOT create the destination directory —
// it errors with ENOENT on the first upload if it's missing.
fs.mkdirSync(PROJECT_DIR, { recursive: true });
console.log(`[UploadConfig] Project files will be stored in: ${PROJECT_DIR}`);

const projectStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, PROJECT_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv7()}${ext}`);
  },
});

/*const projectFileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
): void => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true); // accept
    console.log(`Passed`);
  } else {
    cb(null, false); // reject silently — handled in the controller
    //console.log(file);
    //console.log(file.originalname);
  }
};*/

const uploadProjectFile = multer({
  storage: projectStorage,
  /*fileFilter: projectFileFilter,*/
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
