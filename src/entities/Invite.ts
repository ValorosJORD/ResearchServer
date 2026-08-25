import { BeforeInsert, Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

@Entity()
export class Invite {
  @PrimaryColumn()
  inviteId: string;

  @BeforeInsert()
  generateId(): void {
    this.inviteId = uuidv7();
  }

  @Column()
  email: string;

  @Column({ default: `AUTHORIZED` })
  role: `BANNED` | `AUTHORIZED` | `ADMIN`;

  @Column({ unique: true })
  tokenHash: string;

  @Column()
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @Column()
  createdBy: string;

  @CreateDateColumn()
  createdAt: Date;
}
