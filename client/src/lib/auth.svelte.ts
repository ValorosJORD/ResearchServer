import { api } from './api';

export interface User {
  userId: string;
  email: string;
  username: string;
  name: string;
  role: `BANNED` | `AUTHORIZED` | `ADMIN`;
}

class AuthStore {
  user = $state<User | null>(null);
  loading = $state<boolean>(true);

  async refresh(): Promise<void> {
    this.loading = true;
    try {
      const res = await api.get<User>('/me');
      // res.ok is false for a 401 (not logged in) — that's a normal,
      // expected outcome on public pages, not an error. api.get never
      // throws for it, so without this check res.data (undefined, since
      // a 401 has no JSON body) would get assigned directly to user
      // instead of null, breaking the `user !== null` check isLoggedIn
      // relies on.
      this.user = res.ok ? (res.data ?? null) : null;
    } catch (err) {
      console.error('auth.refresh failed:', err);
      this.user = null;
    } finally {
      this.loading = false;
    }
  }

  setUser(user: User | null): void {
    this.user = user;
  }

  get isLoggedIn(): boolean {
    return this.user !== null;
  }
}

export const auth = new AuthStore();
