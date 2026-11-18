# Email signup: release checklist

**Status: prepared for isolated staging, not released.** Adding these files to Git does not run SQL. Keep Git-triggered deployments off until the owner authorizes a release. Do not use a real member or the production admin account as a test account.

## Candidate changes

- `004-signup-table-grants.sql` removes **TRUNCATE, TRIGGER, REFERENCES and MAINTAIN** on `public.users`, `public.allowed_students` and `public.signup_log` from `anon` and `authenticated`. PostgreSQL 17. It verifies the effective privileges afterward without invoking a maintenance operation. No row edits or changes to regular SELECT/UPDATE grants. Check for any private maintenance automation that runs as a web role before approving the revocation.
- `005-open-email-registration.sql` replaces the old, **unapplied** review-kit draft named `004-open-email-registration.sql`. Do not run both versions. The new candidate requires the reviewed legacy trigger and acceptable write grants; abort on drift. The only column changes are allowing NULL for `public.users.full_name` and `reg_number`. On first email confirmation it inserts the Auth UUID and verified email, an optional username and an explicitly ordinary role. Canonical names/numbers are not taken from untrusted metadata. It retains the existing uniqueness constraints, level defaults and once-only signup log. It does not backfill or rewrite existing profiles, the roster, materials or historical logs.
- Signup requests explicitly specify the same site's `/pages/confirmed.html`. On this site's current **implicit Auth flow**, the callback accepts a matching signup session, checks the confirmed user with Auth, then reads that user's profile ID under RLS. It does not create a profile in JavaScript. An expired link, bare page, unrelated session, different flow or missing profile gets a sign-in fallback, not a success message. A typed legacy signup callback arriving at the homepage is handed to the same page before the normal guard. Do not put callback URLs, tokens or credentials in logs or bug reports.

## What was verified without a production signup

Read-only catalog inspection on 18 November 2026: member profile SELECT/UPDATE policies use the caller's Auth ID; the ordinary role's writable profile columns are username, current level, level-update timestamp and avatar path, not the admin flag or email. The separate Auth email-change trigger mirrors a changed email onto the profile with that same confirmed ID. Before these candidate changes, the first-confirmation trigger still depends on the roster, and both web roles have the four administrative grants listed above. Those are **database privileges**, not evidence that anyone used them or that a public HTTP endpoint exposes those operations.

Email signup and email verification are configured on the live provider, but configuration alone is not an email-delivery test. The restricted owner-only test-reset routines are unrelated to account recovery. Do not call them or rerun their already-completed permissions migration. Do not remove the legacy number-login lookup/eligibility routines while published clients still use them; review retirement after the transition.

## Isolated tests

`tests/auth/frontend-smoke.cjs` and `tests/auth/confirmation-smoke.cjs` use the checkout's page handlers with a mock SDK and no network. `tests/auth/database-smoke.mjs` uses a fresh, in-memory PGlite database and reads the two SQL candidates from this checkout; it does not read a project key or open a production connection. Its miniature legacy schema is for this test only, not a migration to run on a real project.

In Windows PowerShell, run **one line at a time**:

```powershell
$repo = 'C:\Users\Bro\OneDrive\Documents\documents\legalhub-parent\legalhub'
node "$repo\tests\auth\frontend-smoke.cjs" $repo
node "$repo\tests\auth\confirmation-smoke.cjs" $repo
node --test "$repo\tests\password-visibility-coverage.test.cjs"
```

To repeat the optional in-memory database suite, install the pinned test dependency locally (the install may download it); no deployment, SQL CLI, project link or secrets are needed:

```powershell
npm --prefix "$repo\tests\auth" ci --ignore-scripts --no-audit --no-fund
node "$repo\tests\auth\database-smoke.mjs"
```

## Gate: real Auth and a captured confirmation message

1. Agree on a disposable local Auth/Postgres stack and local mail catcher, or an explicitly separate staging project and test mailbox. Use **synthetic data only**. The checkout's normal frontend points to production: do **not** simply serve it locally and submit signup. In a disposable copy, explicitly point the browser at the staging Auth URL + public browser key, set the staging callback allowlist, and verify the outbound destination. Never place a privileged key in a frontend. Nothing should fall back to the live site, live Auth, real R2 buckets or production SMTP.
2. With confirmation ON, apply the two reviewed candidates **only to staging**, in numeric order, against the expected legacy schema. Check permissions via catalog metadata; do not test them by performing a destructive operation. Keep a synthetic existing member and a synthetic existing admin as preservation fixtures.
3. Submit a fresh test email and password with username and number blank. Before verification: no app profile; password sign-in as that test identity must not succeed. Follow the **actual provider-generated confirmation link** from the staging inbox. Require the staging confirmation page and intended same-site destination, not a fallback to the live site. Do not paste the link into chat.
4. In staging only: verify exactly one matching `auth.users.id` / `public.users.id`; verified email, NULL official name/number, `is_admin=false`, correct ordinary defaults. Verify own-profile access, sign out, and sign back in with that same email/password. A claimed optional registration number must not claim another profile or elevate permissions. An existing member/admin must retain their ID, data and prior role. A reused or expired link must not advance an unrelated stored session.
5. Record pass/fail only. A local mail catcher proves message generation and the real confirmation path, **not external inbox deliverability**. If the owner wants proof of external delivery, use a separately authorized staging mailbox and sender. No production test account is required.

## Production order — separate approval required

1. Confirm a recovery/backup option, quiet deployment window and the absence of unintended build/migration automation. Verify intended production callback origin and email settings. Finish the project README before the final release PR.
2. First release an **email-login-capable** page/callback bridge for existing users while retaining the old signup form. The published registration-number login cannot serve new profiles without official numbers. Do not publish this entire worktree before the database is compatible.
3. With explicit owner approval for the exact project and scopes, run the permissions change, verify it, then run the guarded signup migration. Use the existing PostgreSQL trigger; never replay migrations 001–003, run a developer reset, or force a failed preflight. Verify catalogs/trigger binding and constraints without reading members' passwords or other private account data.
4. Only then publish the roster-free signup form. The new code can be committed/pushed to a non-deploying branch independently of this rollout, but a branch push is not itself an approval to change production.

**If a gate fails:** stop and retain email login. After new profiles exist, do not blindly reinstate NOT NULL, restore the roster trigger, reinstate excessive grants, or delete users. Keep existing accounts intact and use a reviewed forward fix.
