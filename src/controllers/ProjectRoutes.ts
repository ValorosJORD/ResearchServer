import { Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import {
  addFilesToProject,
  addProject,
  addUserToProject,
  getAllProjects,
  getProjectById,
  getProjectsByUserId,
  isProjectMember,
} from '../models/ProjectModel.js';
import { getUserByEmail, getUserById } from '../models/UserModel.js';
import { UPLOAD_ROOT } from '../uploadConfig.js';
import { parseDatabaseError } from '../utils/db-utils.js';
import {
  AddProjectUserSchema,
  FileBodySchema,
  ProjectCreationSchema,
  ProjectIdSchema,
} from '../validators/ProjectValidator.js';
import { UserIdSchema } from '../validators/authValidator.js';

async function cleanupOrphanedUploads(files: Express.Multer.File[]): Promise<void> {
  await Promise.all(files.map((f) => fs.unlink(f.path).catch(() => {})));
}

export async function CreateProject(req: Request, res: Response): Promise<void> {
  if (!req.session.isLoggedIn) {
    res.sendStatus(401);
    return;
  }

  const result = ProjectCreationSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json(result.error.flatten());
    return;
  }

  const { title, description } = result.data;
  // The creating user is always the authenticated session's user — never
  // trust a client-supplied userId here, or any caller could create a
  // project "owned" by an arbitrary account.
  const { userId } = req.session.authenticatedUser;

  try {
    const newProject = description
      ? await addProject(title, userId, description)
      : await addProject(title, userId);

    res.status(201).json(newProject);
  } catch (err) {
    console.error(err);
    const databaseErrorMessage = parseDatabaseError(err);
    res.status(500).json(databaseErrorMessage);
  }
}

export async function AccessProject(req: Request, res: Response): Promise<void> {
  if (!req.session.isLoggedIn) {
    res.sendStatus(401);
    return;
  }

  const result = ProjectIdSchema.safeParse(req.params);
  if (!result.success) {
    res.status(400).json(result.error.flatten());
    return;
  }

  const { projectId } = result.data;
  const { userId, role } = req.session.authenticatedUser;

  try {
    const project = await getProjectById(projectId);
    if (project === null) {
      res.status(404).json('Project Not Found.');
      return;
    }

    const isMember = await isProjectMember(projectId, userId);
    if (!isMember && role !== 'ADMIN') {
      res.sendStatus(403);
      return;
    }

    res.status(200).json(project);
  } catch (err) {
    console.error(err);
    const databaseErrorMessage = parseDatabaseError(err);
    res.status(500).json(databaseErrorMessage);
  }
}

// Admin-only: this returns every project in the system, not just the
// caller's own. There's no per-project filtering here, so it's not safe
// to expose to regular users.
export async function AccessAllProjects(req: Request, res: Response): Promise<void> {
  if (!req.session.isLoggedIn || req.session.authenticatedUser.role !== 'ADMIN') {
    res.sendStatus(403);
    return;
  }

  try {
    const projects = await getAllProjects();
    res.status(200).json(projects);
  } catch (err) {
    console.error(err);
    const databaseErrorMessage = parseDatabaseError(err);
    res.status(500).json(databaseErrorMessage);
  }
}

export async function accessUserProjects(req: Request, res: Response): Promise<void> {
  if (!req.session.isLoggedIn) {
    res.sendStatus(401);
    return;
  }

  const result = UserIdSchema.safeParse(req.params);
  if (!result.success) {
    res.status(400).json(result.error.flatten());
    return;
  }

  const { userId } = result.data;
  const requester = req.session.authenticatedUser;

  // Only the user themself, or an admin, can list a user's projects.
  if (requester.userId !== userId && requester.role !== 'ADMIN') {
    res.sendStatus(403);
    return;
  }

  try {
    const user = await getUserById(userId);
    if (!user) {
      res.sendStatus(404);
      return;
    }

    const projects = await getProjectsByUserId(userId);
    res.status(200).json(projects);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
}

export async function ProjectFileUpload(req: Request, res: Response): Promise<void> {
  const files = req.files as Express.Multer.File[];

  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No file uploaded or file rejected' });
    return;
  }

  if (!req.session.isLoggedIn) {
    await cleanupOrphanedUploads(files);
    res.sendStatus(401);
    return;
  }

  const paramsResult = ProjectIdSchema.safeParse(req.params);
  if (!paramsResult.success) {
    await cleanupOrphanedUploads(files);
    res.status(400).json(paramsResult.error.flatten());
    return;
  }

  const bodyResult = FileBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    await cleanupOrphanedUploads(files);
    res.status(400).json(bodyResult.error.flatten());
    return;
  }

  const { projectId } = paramsResult.data;
  const { userId, role } = req.session.authenticatedUser;

  try {
    const isMember = await isProjectMember(projectId, userId);
    if (!isMember && role !== 'ADMIN') {
      await cleanupOrphanedUploads(files);
      res.sendStatus(403);
      return;
    }

    const uploadResults = await addFilesToProject(
      projectId,
      files.map((file) => ({
        // Store relative to UPLOAD_ROOT, not the absolute path multer
        // reports — the absolute path is machine-specific and breaks the
        // moment this runs from a different cwd, machine, or container.
        filePath: path.relative(UPLOAD_ROOT, file.path),
        fileSize: file.size,
        originalName: file.originalname,
        mimeType: file.mimetype,
      })),
    );

    if (!uploadResults) {
      // Project didn't exist — addFilesToProject rolled back the
      // transaction, so there's nothing in the DB to clean up, only disk.
      await cleanupOrphanedUploads(files);
      res.status(404).json('Project not found');
      return;
    }

    res.status(201).json(uploadResults);
  } catch (err) {
    console.error(err);
    // Safe to blanket-delete here even on partial success, since
    // addFilesToProject is transactional — either every file made it into
    // the DB or none did.
    await cleanupOrphanedUploads(files);
    res.sendStatus(500);
  }
}

export async function AddProjectUser(req: Request, res: Response): Promise<void> {
  if (!req.session.isLoggedIn) {
    res.sendStatus(401);
    return;
  }

  const paramsResult = ProjectIdSchema.safeParse(req.params);
  if (!paramsResult.success) {
    res.status(400).json(paramsResult.error.flatten());
    return;
  }

  const bodyResult = AddProjectUserSchema.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json(bodyResult.error.flatten());
    return;
  }

  const { projectId } = paramsResult.data;
  const { email } = bodyResult.data;
  const { userId: requesterId, role: requesterRole } = req.session.authenticatedUser;

  try {
    // Any current member (not just admins) can add another user — this
    // check is on the requester, not the person being added.
    const requesterIsMember = await isProjectMember(projectId, requesterId);
    if (!requesterIsMember && requesterRole !== 'ADMIN') {
      res.sendStatus(403);
      return;
    }

    const project = await getProjectById(projectId);
    if (!project) {
      res.status(404).json('Project not found');
      return;
    }

    const targetUser = await getUserByEmail(email);
    if (!targetUser) {
      res.status(404).json('No account exists for that email.');
      return;
    }

    if (targetUser.role === 'BANNED') {
      res.status(403).json('This user has been banned and cannot be added to projects.');
      return;
    }

    const targetIsAlreadyMember = await isProjectMember(projectId, targetUser.userId);
    if (targetIsAlreadyMember) {
      res.status(409).json('That user is already a member of this project.');
      return;
    }

    await addUserToProject(projectId, targetUser.userId);

    res.sendStatus(204);
  } catch (err) {
    console.error(err);
    const databaseErrorMessage = parseDatabaseError(err);
    res.status(500).json(databaseErrorMessage);
  }
}
