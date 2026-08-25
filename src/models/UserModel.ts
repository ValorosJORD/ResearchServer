import { AppDataSource } from '../dataSource.js';
import { User } from '../entities/User.js';

const userRepository = AppDataSource.getRepository(User);

export async function addUser(
  email: string,
  passwordHash: string,
  username: string,
  role: `BANNED` | `AUTHORIZED` | `ADMIN` = `AUTHORIZED`,
  name: string = 'New User',
): Promise<User> {
  const newUser = new User();
  newUser.email = email;
  newUser.passwordHash = passwordHash;
  newUser.username = username;
  newUser.name = name;
  newUser.role = role;

  return await userRepository.save(newUser);
}

export async function getUserById(userId: string): Promise<User | null> {
  return await userRepository.findOne({ where: { userId } });
}

export async function getUserByEmail(email: string): Promise<User | null> {
  return await userRepository.findOne({ where: { email } });
}

export async function existingAdmin(): Promise<boolean> {
  if (await userRepository.findOne({ where: { role: 'ADMIN' } })) {
    console.log(`found it`);
    return true;
  } else {
    return false;
  }
}

export async function deleteUser(email: string, passwordHash: string): Promise<void> {
  const user = await userRepository.findOne({ where: { email, passwordHash } });
  if (!user) {
    return;
  }
  await userRepository.remove(user);
}
