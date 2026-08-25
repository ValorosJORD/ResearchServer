import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  ManyToMany,
  PrimaryColumn,
  Relation,
} from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { Project } from './Project.js';

@Entity()
export class User {
  @PrimaryColumn()
  userId: string;

  @BeforeInsert()
  generateId(): void {
    this.userId = uuidv7();
  }

  @Column({ unique: true })
  email: string;

  @Column()
  passwordHash: string;

  @Column({ default: false })
  verifiedEmail: boolean;

  @Column()
  username: string;

  @Column()
  name: string;

  @Column({ default: `AUTHORIZED` })
  role: `BANNED` | `AUTHORIZED` | `ADMIN`;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToMany(() => Project, (project) => project.users)
  projects: Relation<Project>[];
}
