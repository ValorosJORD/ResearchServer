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
import { Project } from './Project.js';

@Entity()
export class ProjectFile {
  @PrimaryColumn()
  fileId: string;

  @BeforeInsert()
  generateId(): void {
    this.fileId = uuidv7();
  }

  // Relative path on disk, e.g. uploads/projects/<uuid>.ext. Unique but no
  // longer the primary key — lookups go through fileId instead.
  @Column({ unique: true })
  filePath: string;

  @Column()
  fileSize: number;

  @Column()
  originalName: string;

  @Column()
  mimeType: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  lastEdited: Date;

  @ManyToOne(() => Project, (project) => project.projectFiles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project: Relation<Project>;
}
