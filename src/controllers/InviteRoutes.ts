import argon2 from 'argon2';
import crypto from 'crypto';
import { Request, Response } from 'express';
import {
  claimInviteAndCreateUser,
  createInvite,
  deleteUnusedInvitesForEmail,
  findInviteByTokenHash,
} from '../models/InviteModel.js';
import { sendInviteEmail } from '../services/EmailService.js';
import { parseDatabaseError } from '../utils/db-utils.js';
import {
  AcceptInviteSchema,
  CheckInviteSchema,
  CreateInviteSchema,
} from '../validators/InviteValidator.js';

const TOKEN_BYTES = 32; // 256 bits
const INVITE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export async function CreateUserInvite(req: Request, res: Response): Promise<void> {
  if (!req.session.isLoggedIn || req.session.authenticatedUser.role !== 'ADMIN') {
    res.sendStatus(403);
    return;
  }

  const result = CreateInviteSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json(result.error.flatten());
    return;
  }

  const { email, role } = result.data;

  try {
    const rawToken = crypto.randomBytes(TOKEN_BYTES).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    // Only one valid, unused invite per email at a time.
    await deleteUnusedInvitesForEmail(email);
    await createInvite(email, role, tokenHash, expiresAt, req.session.authenticatedUser.userId);

    const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
    const inviteUrl = `${appUrl}/accept-invite?token=${rawToken}`;
    await sendInviteEmail(email, inviteUrl);

    res.sendStatus(201);
  } catch (err) {
    console.error(err);
    const databaseErrorMessage = parseDatabaseError(err);
    res.status(500).json(databaseErrorMessage);
  }
}

// Lets the accept-invite page confirm the token is valid before rendering
// the form, without needing to guess it's fine from a bare GET 200.
export async function CheckUserInvite(req: Request, res: Response): Promise<void> {
  const result = CheckInviteSchema.safeParse(req.query);
  if (!result.success) {
    res.status(400).json(result.error.flatten());
    return;
  }

  const { token } = result.data;
  const tokenHash = hashToken(token);

  try {
    const invite = await findInviteByTokenHash(tokenHash);

    // Same message regardless of whether the token was missing, expired,
    // or already used — don't give an attacker anything to distinguish.
    if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
      res.status(400).json('Invalid or expired invite link');
      return;
    }

    res.status(200).json({ email: invite.email });
  } catch (err) {
    console.error(err);
    const databaseErrorMessage = parseDatabaseError(err);
    res.status(500).json(databaseErrorMessage);
  }
}

export async function AcceptUserInvite(req: Request, res: Response): Promise<void> {
  const result = AcceptInviteSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json(result.error.flatten());
    return;
  }

  const { token, password, username, name } = result.data;
  const tokenHash = hashToken(token);

  try {
    const passwordHash = await argon2.hash(password);
    const newUser = await claimInviteAndCreateUser(tokenHash, passwordHash, username, name);

    if (!newUser) {
      res.status(400).json('Invalid or expired invite link');
      return;
    }

    await req.session.clearSession();

    req.session.authenticatedUser = {
      userId: newUser.userId,
      email: newUser.email,
      username: newUser.username,
      name: newUser.name,
      role: newUser.role,
    };
    req.session.isLoggedIn = true;

    res.sendStatus(201);
  } catch (err) {
    console.error(err);
    const databaseErrorMessage = parseDatabaseError(err);
    res.status(500).json(databaseErrorMessage);
  }
}
