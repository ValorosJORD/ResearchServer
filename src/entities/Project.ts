import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  OneToMany,
  PrimaryColumn,
  Relation,
  UpdateDateColumn,
} from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { ProjectFile } from './ProjectFile.js';
import { User } from './User.js';

@Entity()
export class Project {
  @PrimaryColumn()
  projectId: string;

  @BeforeInsert()
  generateId(): void {
    this.projectId = uuidv7();
  }

  @Column()
  title: string;

  @Column()
  description: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  lastEdited: Date;

  @OneToMany(() => ProjectFile, (projectFile) => projectFile.project)
  projectFiles: Relation<ProjectFile>[];

  @ManyToMany(() => User, (user) => user.projects)
  @JoinTable({
    name: 'project_users', // optional: custom join table name
    joinColumn: { name: 'projectId', referencedColumnName: 'projectId' },
    inverseJoinColumn: { name: 'userId', referencedColumnName: 'userId' },
  })
  users: Relation<User>[];
}
