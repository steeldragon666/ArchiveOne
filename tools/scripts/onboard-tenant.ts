#!/usr/bin/env tsx
/**
 * Platform-admin CLI to seed a brand-new consultant firm with its first
 * admin user.
 *
 * Usage (run from `tools/scripts/`):
 *   pnpm exec tsx --env-file=../../.env onboard-tenant.ts \
 *     --name "Firm Foo" \
 *     --slug firm-foo \
 *     --admin-email alice@firmfoo.com \
 *     [--primary-idp microsoft|google|mixed]
 *
 * (Run via `pnpm --filter @cpa/tools-scripts onboard-tenant` works too,
 *  but pnpm's `--` forwarding makes flag-passing fiddly for a script
 *  meant to be invoked occasionally by a human admin.)
 *
 * Behaviour:
 *   1. Look up the admin user by email. They must already exist (one
 *      successful OIDC sign-in via Microsoft or Google has populated
 *      the `user` row). On miss: returns user_not_found.
 *   2. Create the tenant via privilegedSql. On UNIQUE(slug) violation:
 *      returns slug_conflict (no rollback needed; nothing else has been
 *      written yet).
 *   3. Insert the tenant_user (role='admin', is_default=true). If this
 *      fails, the just-created tenant is hard-deleted to keep the DB
 *      from accumulating orphan tenants.
 *
 * Per ADR-0002 §Q5: this is the platform-admin onboarding path. There
 * is intentionally NO API endpoint — admins SSH or use a bastion to run
 * this CLI. Splitting tenant-creation from API surface area means a
 * compromised consultant session can never escalate to "create a new
 * firm".
 *
 * Exit codes (CLI mode):
 *   0 — success (tenant + admin created)
 *   1 — validation/lookup failure (user_not_found, slug_conflict, or
 *       missing/malformed CLI flags). stderr carries a human message.
 *   2 — unexpected error (DB connection, etc.). stderr carries the
 *       stringified error.
 */
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { privilegedSql } from '@cpa/db/client';

export interface OnboardArgs {
  name: string;
  slug: string;
  adminEmail: string;
  primaryIdp: 'microsoft' | 'google' | 'mixed';
}

export type OnboardResult =
  | { kind: 'ok'; tenantId: string; userId: string; adminEmail: string }
  | { kind: 'user_not_found'; email: string }
  | { kind: 'slug_conflict'; slug: string };

/**
 * Programmatic entry point. Returns a discriminated-union result so
 * callers (CLI wrapper + tests) can branch on the kind without throwing
 * for the two expected validation failures. Truly unexpected errors
 * still throw.
 */
export async function onboardTenant(args: OnboardArgs): Promise<OnboardResult> {
  // 1. Look up admin user by email. Filter out soft-deleted rows so a
  //    rehired admin's stale row can't accidentally satisfy this check.
  const userRows = await privilegedSql<{ id: string }[]>`
    SELECT id FROM "user"
     WHERE email = ${args.adminEmail} AND deleted_at IS NULL
  `;
  if (!userRows[0]) {
    return { kind: 'user_not_found', email: args.adminEmail };
  }
  const userId = userRows[0].id;

  // 2. Create tenant. If the slug is already taken, Postgres raises
  //    SQLSTATE 23505 (unique_violation) on the `slug` UNIQUE
  //    constraint; we surface that as slug_conflict.
  const tenantId = crypto.randomUUID();
  try {
    await privilegedSql`
      INSERT INTO tenant (id, name, slug, primary_idp)
      VALUES (${tenantId}, ${args.name}, ${args.slug}, ${args.primaryIdp})
    `;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return { kind: 'slug_conflict', slug: args.slug };
    }
    throw err;
  }

  // 3. Insert tenant_user (admin, is_default). If this fails, hard-
  //    delete the tenant we just created so the operator can retry the
  //    CLI without a lingering empty tenant. The tenant has no FK
  //    dependents at this point, so a plain DELETE is safe.
  const tenantUserId = crypto.randomUUID();
  try {
    await privilegedSql`
      INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
      VALUES (${tenantUserId}, ${tenantId}, ${userId}, 'admin', true)
    `;
  } catch (err) {
    await privilegedSql`DELETE FROM tenant WHERE id = ${tenantId}`;
    throw err;
  }

  return { kind: 'ok', tenantId, userId, adminEmail: args.adminEmail };
}

const HELP_TEXT = `Usage (from tools/scripts/):
  pnpm exec tsx --env-file=../../.env onboard-tenant.ts \\
    --name "Firm Foo" \\
    --slug firm-foo \\
    --admin-email alice@firmfoo.com \\
    [--primary-idp microsoft|google|mixed]

Per ADR-0002, the admin user must already exist in the database
(they have signed in once via Microsoft or Google). Re-run after
they've completed an OIDC login.
`;

function parseArgsOrExit(): OnboardArgs {
  // `allowPositionals: true` lets us tolerate a stray `--` separator that
  // `pnpm run -- ...` injects into argv. We don't otherwise consume the
  // positionals — they're just silently ignored.
  const { values } = parseArgs({
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      slug: { type: 'string' },
      'admin-email': { type: 'string' },
      'primary-idp': { type: 'string', default: 'mixed' },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }

  const errors: string[] = [];
  if (!values.name) errors.push('--name is required');
  if (!values.slug || !/^[a-z0-9-]{2,64}$/.test(values.slug)) {
    errors.push('--slug is required (lowercase letters, digits, hyphens; 2-64 chars)');
  }
  const email = values['admin-email'];
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    errors.push('--admin-email is required (valid email)');
  }
  const idp = values['primary-idp'] ?? 'mixed';
  if (!['microsoft', 'google', 'mixed'].includes(idp)) {
    errors.push("--primary-idp must be 'microsoft', 'google', or 'mixed'");
  }

  if (errors.length) {
    process.stderr.write('Validation errors:\n');
    for (const e of errors) process.stderr.write('  - ' + e + '\n');
    process.exit(1);
  }

  return {
    name: values.name as string,
    slug: values.slug as string,
    adminEmail: email as string,
    primaryIdp: idp as 'microsoft' | 'google' | 'mixed',
  };
}

async function main(): Promise<void> {
  const args = parseArgsOrExit();
  const result = await onboardTenant(args);

  switch (result.kind) {
    case 'ok':
      process.stdout.write(
        [
          'Tenant created:',
          '  tenant_id:    ' + result.tenantId,
          '  name:         ' + args.name,
          '  slug:         ' + args.slug,
          '  primary_idp:  ' + args.primaryIdp,
          'Admin assigned:',
          '  user_id:      ' + result.userId,
          '  email:        ' + args.adminEmail,
          '',
        ].join('\n'),
      );
      await privilegedSql.end();
      process.exit(0);

    case 'user_not_found':
      process.stderr.write(
        `User '${result.email}' not found.\n` +
          `Ask them to sign in once via Microsoft or Google, then re-run.\n`,
      );
      await privilegedSql.end();
      process.exit(1);

    case 'slug_conflict':
      process.stderr.write(`Tenant slug '${result.slug}' already exists. Pick a different slug.\n`);
      await privilegedSql.end();
      process.exit(1);
  }
}

// Direct-invoke gate. Tests import this module — they MUST NOT trigger main().
// `pathToFileURL` handles the Windows `file:///C:/...` (three-slash) form
// correctly; a hand-rolled `'file://' + replace(/\\/g, '/')` produces a
// two-slash URL on Windows that never matches `import.meta.url`.
const argv1 = process.argv[1];
const isDirectInvoke = typeof argv1 === 'string' && import.meta.url === pathToFileURL(argv1).href;
if (isDirectInvoke) {
  main().catch((err: unknown) => {
    process.stderr.write('Unexpected error: ' + String(err) + '\n');
    process.exit(2);
  });
}
