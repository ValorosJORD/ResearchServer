import { AppDataSource } from '../dataSource.js';
import { Project } from '../entities/Project.js';
import { ProjectFile } from '../entities/ProjectFile.js';
import { User } from '../entities/User.js';
import { FileEncryptionMeta } from '../services/FileEncryption.js';
import { ClassificationResult } from '../services/MalwareClassifier.js';

const projectRepository = AppDataSource.getRepository(Project);
const projectFileRepository = AppDataSource.getRepository(ProjectFile);

export async function addProject(
  title: string,
  userId: string,
  description: string = 'No Description',
): Promise<Project> {
  const newProject = new Project();
  newProject.title = title;
  newProject.users = [{ userId } as User];
  newProject.description = description;

  return await projectRepository.save(newProject);
}

export async function getProjectById(projectId: string): Promise<Project | null> {
  return await projectRepository.findOne({
    where: { projectId },
    relations: { projectFiles: true },
  });
}

export async function getAllProjects(): Promise<Project[]> {
  return projectRepository.find();
}

export async function addFileToProject(
  projectId: string,
  filePath: string,
  fileSize: number,
  originalName: string,
  mimeType: string,
): Promise<ProjectFile | null> {
  const project = await projectRepository.findOne({ where: { projectId } });

  if (!project) {
    return null;
  }

  const projectFile = new ProjectFile();
  projectFile.project = project;
  projectFile.filePath = filePath;
  projectFile.fileSize = fileSize;
  projectFile.originalName = originalName;
  projectFile.mimeType = mimeType;

  return await projectFileRepository.save(projectFile);
}

interface NewProjectFileInput {
  filePath: string;
  fileSize: number;
  originalName: string;
  mimeType: string;
  encryption: FileEncryptionMeta;
  classification: ClassificationResult;
}

/**
 * Attaches multiple files to a project atomically: either the project
 * exists and every file record is saved, or nothing is saved. This avoids
 * the partial-failure case where some files succeed and others throw
 * mid-batch, leaving orphaned DB rows for files the caller then deletes
 * from disk.
 */
export async function addFilesToProject(
  projectId: string,
  files: NewProjectFileInput[],
): Promise<ProjectFile[] | null> {
  return await AppDataSource.transaction(async (manager) => {
    const project = await manager.findOne(Project, { where: { projectId } });
    if (!project) {
      return null;
    }

    const projectFiles = files.map((f) => {
      const projectFile = new ProjectFile();
      projectFile.project = project;
      projectFile.filePath = f.filePath;
      projectFile.fileSize = f.fileSize;
      projectFile.originalName = f.originalName;
      projectFile.mimeType = f.mimeType;
      projectFile.encryption = f.encryption;
      projectFile.classification = f.classification;
      return projectFile;
    });

    return await manager.save(ProjectFile, projectFiles);
  });
}

export async function getProjectsByUserId(userId: string): Promise<Project[]> {
  return await projectRepository.find({
    where: { users: { userId } },
  });
}

export async function isProjectMember(projectId: string, userId: string): Promise<boolean> {
  const count = await projectRepository
    .createQueryBuilder('project')
    .innerJoin('project.users', 'user', 'user.userId = :userId', { userId })
    .where('project.projectId = :projectId', { projectId })
    .getCount();

  return count > 0;
}

/**
 * Inserts directly into the project_users join table via TypeORM's
 * relation query builder, rather than loading the full Project + users
 * array and re-saving — cheaper, and avoids accidentally clobbering the
 * existing members array on a concurrent request.
 */
export async function addUserToProject(projectId: string, userId: string): Promise<void> {
  await projectRepository.createQueryBuilder().relation(Project, 'users').of(projectId).add(userId);
}
