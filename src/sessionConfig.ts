import connectPgSimple from 'connect-pg-simple';
import session from 'express-session';
import { Pool } from 'pg';

const isProduction = process.env.NODE_ENV === 'production';

const PostgresStore = connectPgSimple(session);

// Store sessions in PostgreSQL

const pgPool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL_MODE === 'require' ? { rejectUnauthorized: false } : false,
});

const sessionStorage = new PostgresStore({
  createTableIfMissing: true,
  pool: pgPool,
});

const sessionMiddleware = session({
  store: sessionStorage,
  secret: process.env.COOKIE_SECRET, // Signs cookie to prevent forgery
  cookie: {
    maxAge: 8 * 60 * 60 * 1000, // 8-hour session expiry
    httpOnly: true, // No client-side JS access (XSS protection)
    secure: isProduction, // HTTPS only in production
    sameSite: 'lax', // Basic CSRF protection
  },
  name: 'session', // Cookie name in the browser
  resave: false, // Skip re-saving unmodified sessions
  saveUninitialized: false, // Don't save empty sessions (no cookie until session is used)
});

export { sessionMiddleware };
