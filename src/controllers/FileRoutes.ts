import { Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { deleteProjectFile, getFileById, getFilesByProject } from '../models/FileModel.js';
import { isProjectMember } from '../models/ProjectModel.js';
import { UPLOAD_ROOT } from '../uploadConfig.js';
import { parseDatabaseError } from '../utils/db-utils.js';
import { FileIdParamSchema, ProjectIdParamSchema } from '../validators/FileValidator.js';

// Upload lives in ProjectRoutes.ts as ProjectFileUpload — this file only
// covers reading files back (list + download), which nothing else handles.

export async function ListProjectFiles(req: Request, res: Response): Promise<void> {
  if (!req.session.isLoggedIn) {
    res.sendStatus(401);
    return;
  }

  const result = ProjectIdParamSchema.safeParse(req.params);
  if (!result.success) {
    res.status(400).json(result.error.flatten());
    return;
  }

  const { projectId } = result.data;
  const { userId, role } = req.session.authenticatedUser;

  try {
    const isMember = await isProjectMember(projectId, userId);
    if (!isMember && role !== 'ADMIN') {
      res.sendStatus(403);
      return;
    }

    const files = await getFilesByProject(projectId);
    res.status(200).json(files);
  } catch (err) {
    console.error(err);
    const databaseErrorMessage = parseDatabaseError(err);
    res.status(500).json(databaseErrorMessage);
  }
}

export async function AccessFile(req: Request, res: Response): Promise<void> {
  if (!req.session.isLoggedIn) {
    res.sendStatus(401);
    return;
  }

  const result = FileIdParamSchema.safeParse(req.params);
  if (!result.success) {
    res.status(400).json(result.error.flatten());
    return;
  }

  const { fileId } = result.data;
  const { userId, role } = req.session.authenticatedUser;

  try {
    const file = await getFileById(fileId);
    if (!file) {
      res.status(404).json('File not found');
      return;
    }

    const isMember = await isProjectMember(file.project.projectId, userId);
    if (!isMember && role !== 'ADMIN') {
      res.sendStatus(403);
      return;
    }

    // file.filePath is stored relative to UPLOAD_ROOT — always resolve it
    // against that same root, never on its own, so it means the same thing
    // regardless of the server process's current working directory.
    const absolutePath = path.join(UPLOAD_ROOT, file.filePath);

    try {
      await fs.access(absolutePath);
    } catch {
      res.status(404).json('File not found on disk');
      return;
    }

    // res.download sets Content-Disposition using the original filename,
    // rather than leaking the on-disk uuid-based name to the client.
    res.download(absolutePath, file.originalName);
  } catch (err) {
    console.error(err);
    const databaseErrorMessage = parseDatabaseError(err);
    res.status(500).json(databaseErrorMessage);
  }
}

export async function DeleteFile(req: Request, res: Response): Promise<void> {
  if (!req.session.isLoggedIn) {
    res.sendStatus(401);
    return;
  }

  const result = FileIdParamSchema.safeParse(req.params);
  if (!result.success) {
    res.status(400).json(result.error.flatten());
    return;
  }

  const { fileId } = result.data;
  const { userId, role } = req.session.authenticatedUser;

  try {
    const file = await getFileById(fileId);
    if (!file) {
      res.status(404).json('File not found');
      return;
    }

    const isMember = await isProjectMember(file.project.projectId, userId);
    if (!isMember && role !== 'ADMIN') {
      res.sendStatus(403);
      return;
    }

    const deleted = await deleteProjectFile(fileId);
    if (!deleted) {
      // Race: the file was removed by someone else between our lookup
      // above and this call.
      res.status(404).json('File not found');
      return;
    }

    // Best-effort disk cleanup. The DB row is already gone at this point
    // either way, so a failure here (already missing, permissions, etc.)
    // shouldn't fail the request — just log it for manual follow-up.
    const absolutePath = path.join(UPLOAD_ROOT, deleted.filePath);
    await fs.unlink(absolutePath).catch((err) => {
      console.error(`Failed to remove file from disk: ${absolutePath}`, err);
    });

    res.sendStatus(204);
  } catch (err) {
    console.error(err);
    const databaseErrorMessage = parseDatabaseError(err);
    res.status(500).json(databaseErrorMessage);
  }
}
