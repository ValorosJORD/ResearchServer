import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Relation,
  UpdateDateColumn,
} from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { FileEncryptionMeta } from '../services/FileEncryption.js';
import { Project } from './Project.js';

@Entity()
export class ProjectFile {
  @PrimaryColumn()
  fileId: string;

  @BeforeInsert()
  generateId(): void {
    this.fileId = uuidv7();
  }

  // Relative path on disk, e.g. uploads/projects/<uuid>.ext. Unique but
  // not the primary key — lookups go through fileId instead.
  @Column({ unique: true })
  filePath: string;

  @Column()
  fileSize: number;

  @Column()
  originalName: string;

  @Column()
  mimeType: string;

  // Nullable: files uploaded before this feature existed have no
  // encryption metadata and are served as plaintext (see AccessFile's
  // fallback). Every new upload always populates this.
  @Column({ type: 'jsonb', nullable: true })
  encryption: FileEncryptionMeta | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  lastEdited: Date;

  @ManyToOne(() => Project, (project) => project.projectFiles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project: Relation<Project>;
}
