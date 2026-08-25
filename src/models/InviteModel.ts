import { IsNull, MoreThan } from 'typeorm';
import { AppDataSource } from '../dataSource.js';
import { Invite } from '../entities/Invite.js';
import { User } from '../entities/User.js';

const inviteRepository = AppDataSource.getRepository(Invite);

export async function createInvite(
  email: string,
  role: `BANNED` | `AUTHORIZED` | `ADMIN`,
  tokenHash: string,
  expiresAt: Date,
  createdBy: string,
): Promise<Invite> {
  const newInvite = new Invite();
  newInvite.email = email;
  newInvite.role = role;
  newInvite.tokenHash = tokenHash;
  newInvite.expiresAt = expiresAt;
  newInvite.createdBy = createdBy;

  return await inviteRepository.save(newInvite);
}

export async function findInviteByTokenHash(tokenHash: string): Promise<Invite | null> {
  return await inviteRepository.findOne({ where: { tokenHash } });
}

export async function deleteUnusedInvitesForEmail(email: string): Promise<void> {
  await inviteRepository.delete({ email, usedAt: IsNull() });
}

/**
 * Atomically marks an invite as used and creates the corresponding user
 * in a single transaction. This closes the race-condition window where
 * two requests try to accept the same token concurrently, and prevents
 * an invite being burned if user creation fails partway through.
 *
 * Returns null if the token is missing, expired, or already used.
 */
export async function claimInviteAndCreateUser(
  tokenHash: string,
  passwordHash: string,
  username: string,
  name: string,
): Promise<User | null> {
  return await AppDataSource.transaction(async (manager) => {
    const claimResult = await manager.update(
      Invite,
      { tokenHash, usedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      { usedAt: new Date() },
    );

    if (!claimResult.affected) {
      return null;
    }

    const invite = await manager.findOneOrFail(Invite, { where: { tokenHash } });

    const newUser = new User();
    newUser.email = invite.email;
    newUser.passwordHash = passwordHash;
    newUser.username = username;
    newUser.name = name;
    newUser.role = invite.role;

    return await manager.save(newUser);
  });
}
