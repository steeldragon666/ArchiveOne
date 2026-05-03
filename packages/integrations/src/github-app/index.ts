// GitHub App auth surface (Task B.2 / P7).
//
// Two-tier auth model: mint a short-lived App JWT, exchange it for a
// per-installation access token, cache the result. See module-level
// docs in jwt.ts and installation-token.ts.
export { createAppJwt, type CreateAppJwtOptions } from './jwt.js';
export { getInstallationToken, type GetInstallationTokenOptions } from './installation-token.js';
export {
  getGitHubAppHeaders,
  type CreateOctokitOptions,
  type GitHubAppHeaders,
} from './octokit-factory.js';
