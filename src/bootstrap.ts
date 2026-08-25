import argon2 from 'argon2';
import { addUser, existingAdmin } from './models/UserModel.js';

export async function ensureMasterAccount(): Promise<void> {
  const adminExists = await existingAdmin;
  if (await adminExists()) {
    console.log('Admin account already exists, skipping bootstrap.');
    return;
  }

  const email = process.env.ADMIN_EMAIL;
  if (!email) {
    throw new Error('ADMIN_EMAIL env var is required for first-run bootstrap.');
  }
  const providedPassword = process.env.ADMIN_INITIAL_PASSWORD;
  if (!providedPassword) {
    throw new Error('ADMIN_INITIAL_PASSWORD env var is required for first-run bootstrap.');
  }
  const username = process.env.ADMIN_USERNAME;
  if (!providedPassword) {
    throw new Error('ADMIN_USERNAME env var is required for first-run bootstrap.');
  }

  try {
    const passwordHash = await argon2.hash(providedPassword);
    const newUser = await addUser(email, passwordHash, username, `ADMIN`);
    console.log(newUser);
  } catch (err) {
    console.error(err);
  }

  console.log('=== MASTER ACCOUNT CREATED ===');
  console.log(`Email: ${email}`);
}
