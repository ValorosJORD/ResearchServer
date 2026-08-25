import { AppDataSource } from '../dataSource.js';
import { ProjectFile } from '../entities/ProjectFile.js';

const fileRepository = AppDataSource.getRepository(ProjectFile);

export async function getFileById(fileId: string): Promise<ProjectFile | null> {
  return await fileRepository.findOne({
    where: { fileId },
    relations: { project: true },
  });
}

export async function getFilesByProject(projectId: string): Promise<ProjectFile[]> {
  return await fileRepository.find({
    where: { project: { projectId } },
    order: { createdAt: 'DESC' },
  });
}

// Plain data, not a ProjectFile entity instance — after removal there's no
// live row to represent, and a class-shaped return type would incorrectly
// require entity-only members like the @BeforeInsert() generateId method.
export interface DeletedProjectFile {
  fileId: string;
  filePath: string;
  fileSize: number;
  originalName: string;
  mimeType: string;
}

export async function deleteProjectFile(fileId: string): Promise<DeletedProjectFile | null> {
  const file = await getFileById(fileId);
  if (!file) {
    return null;
  }

  // Capture the fields we still need for disk cleanup before .remove()
  // runs — TypeORM clears the primary key on the entity object it
  // returns after removal.
  const removed: DeletedProjectFile = {
    fileId: file.fileId,
    filePath: file.filePath,
    fileSize: file.fileSize,
    originalName: file.originalName,
    mimeType: file.mimeType,
  };

  await fileRepository.remove(file);
  return removed;
}
