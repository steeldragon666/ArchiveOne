import { LoginForm } from './login-form';

/**
 * Magic-link login landing page — the only public sign-in surface
 * while OIDC and dev-login remain gated off in the API.
 *
 * Server component wrapper around the `<LoginForm>` client component.
 * The form POSTs `/v1/auth/login` with the user's email; the API
 * always returns a generic "if that email is registered…" response,
 * so the client just navigates to `/login/sent` on any 2xx and
 * surfaces a generic error otherwise.
 *
 * Design language mirrors the engagement-letter sign page (inline
 * `style` props sourced from `consultant/_components/tokens.ts` —
 * no Tailwind, no CSS modules; the consultant workspace is the only
 * consumer of these tokens).
 */
export default function LoginPage() {
  return <LoginForm />;
}
