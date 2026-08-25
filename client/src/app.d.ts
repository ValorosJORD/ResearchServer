declare global {
  namespace App {
    interface Locals {
      auth: {
        isLoggedIn: boolean;
        user?: {
          userId: string;
          email: string;
          username: string;
          name: string;
          role: `BANNED` | `AUTHORIZED` | `ADMIN`;
        };
      };
      requestId: string;
    }
  }
}

export {};
