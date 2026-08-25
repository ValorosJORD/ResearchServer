import express, { Express } from 'express';
import { ensureMasterAccount } from './bootstrap.js';
import './config.js'; // do not remove this line
import { requireAuth } from './middleware/AuthRequire.js';
import { sessionMiddleware } from './sessionConfig.js';
import { uploadErrorHandler, uploadProjectFile } from './uploadConfig.js';

import { AccessFile, DeleteFile, ListProjectFiles } from './controllers/FileRoutes.js';
import { AcceptUserInvite, CheckUserInvite, CreateUserInvite } from './controllers/InviteRoutes.js';
import {
  AccessProject,
  accessUserProjects,
  AddProjectUser,
  CreateProject,
  ProjectFileUpload,
} from './controllers/ProjectRoutes.js';
import {
  AccessUserById,
  getMe,
  logIn,
  logOut,
  RemoveUserAccount,
} from './controllers/UserRoutes.js';

const app: Express = express();
const PORT = process.env.PORT ?? 3000;

// -- Core middleware -----------------------------------------
app.use(sessionMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// -- Static file serving ---------------------------------------
// `public` is for anything meant to be served as-is, publicly.
app.use(express.static('public', { extensions: ['html'] }));
// The built Svelte frontend.
app.use(express.static('frontend/build'));

// Uploaded project files are deliberately NOT served via express.static —
// that bypasses login and project-membership checks entirely. All access
// goes through AccessFile below instead, which checks both.

// -- Startup ---------------------------------------------------
await ensureMasterAccount();

// -- Public routes (no session required) ------------------------
app.post('/api/login', logIn);
app.delete('/api/sessions', logOut);
app.get('/api/me', getMe); // returns the signed-in user, or 401 — handles "not logged in" itself

// SECURITY: account creation is supposed to be invite-only (see
// /api/invites/accept below). This route bypasses that entirely — left
// disabled. Only re-enable if open self-registration is actually intended.
// app.post('/api/users', registerUser);

app.get('/api/users/:userId', AccessUserById);

app.post('/api/invites', CreateUserInvite); // admin-only, creates + emails an invite
app.get('/api/invites', CheckUserInvite); // ?token=... validates before rendering the accept form
app.post('/api/invites/accept', AcceptUserInvite); // consumes the token, creates the account, logs in

// File routes — each controller already checks isLoggedIn + project
// membership internally, so these are safe to mount directly.
app.post(
  '/api/projects/:projectId/files',
  uploadProjectFile.array('files'), // field name must match the frontend's FormData: 'files'
  uploadErrorHandler,
  ProjectFileUpload,
);
app.get('/api/projects/:projectId/files', ListProjectFiles);
app.get('/api/files/:fileId', AccessFile);
app.delete('/api/files/:fileId', DeleteFile);

// -- Protected routes (require an active session) ------------------
const authPath = express.Router();
authPath.use(requireAuth);

authPath.post('/api/projects', CreateProject);
authPath.get('/api/projects/:projectId', AccessProject);
authPath.post('/api/projects/:projectId/users', AddProjectUser);
authPath.get('/api/users/:userId/projects', accessUserProjects);
authPath.post('/api/users/:userId/delete', RemoveUserAccount);

app.use(authPath);

// -- SPA fallback ----------------------------------------------
// Keep these LAST, after every `/api/*` route above.
app.use('/api', (req, res) => {
  res.sendStatus(404);
});

// Any other unmatched request falls back to the Svelte app so client-side
// routing works on refresh.
app.use((req, res) => {
  res.sendFile('index.html', { root: 'frontend/build' });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
