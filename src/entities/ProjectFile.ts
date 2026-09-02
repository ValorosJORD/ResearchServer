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
import { ClassificationResult } from '../services/MalwareClassifier.js';
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

  // Nullable for the same reason as `encryption` above: rows created
  // before this feature existed (and any future upload types that aren't
  // classified) have no result here. Every NEW .dex/.apk upload always
  // populates this — classification failure rejects the upload outright
  // rather than creating a row with a null result.
  @Column({ type: 'jsonb', nullable: true })
  classification: ClassificationResult | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  lastEdited: Date;

  @ManyToOne(() => Project, (project) => project.projectFiles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project: Relation<Project>;
}
