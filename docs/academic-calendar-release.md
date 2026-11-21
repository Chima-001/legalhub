# Academic calendar and annual levels — release notes

**Status: the calendar and compatible November service are active on the LegalHub project. Do not replay 006 or 007.** Git does not install migrations. A Live Server checkout can still point to production Supabase. Use the offline tests or an explicitly isolated staging backend for testing; do not create a live test account.

## Active calendar

- A signed-in student reads one public-to-members schedule. Administrators additionally see **Admin settings** in the homepage navigation. The static page is not a secret: it renders no editor until the server confirms the caller's current role. Every write checks the role again in the database using `auth.uid()` and the stored admin flag. No caller-selected UID, role, service key or client-side role claim authorizes a write.
- Set consecutive academic years (for example `2026/2027`), first or second semester, semester start, exam start and exam end. **Exam end is semester end**, inclusive. All school dates use **Africa/Lagos**, not the device's timezone. There is no fabricated initial schedule or invented exam end. An empty schedule, a failed read, a term not yet started, teaching, exams, the final day and a completed term have distinct displays.
- Publish the first calendar or replace the active dates with an exact typed confirmation. Changing any draft field clears the confirmation. The database checks the phrase, dates, role and expected revision; a stale editor must reload. There is one active row, no delete button and no term-history table. Students cannot write directly to the calendar table. A visible homepage reloads on a return to the tab and once per minute; it does not require a code edit to restart the countdown.

## Level rule approved for this transition

All pre-existing saved levels are levels **for 2025/2026**, irrespective of signup or last-edit time. Migration 007 adds a nullable `level_base_year` without a backfill; NULL means 2025. It sets a default for *future* inserts in a separate statement. It does not overwrite existing `current_level`, `level_updated_at`, identifiers or role flags.

The display advances one tier on each **7 November** at midnight in Lagos and stops at 500L. For example, a legacy 100L shows 100L on 6 November 2026, 200L on 7 November, still 200L on 1 December, and 300L on 7 November 2027. After the 2026 boundary has passed, eligible legacy students see the new level on the next read. Reading a profile, logging in, updating dates or starting a semester never writes a promotion. If `current_level` is absent, a recognised tier in the older library `level` column counts as the saved level. With neither, the old 100L display fallback stays 100L rather than inventing a promotion. Unrecognised `current_level` text is not silently reclassified.

New profiles and explicit profile corrections use the current November cycle **unless the immediately upcoming session has already been published**, in which case the upcoming session is used. This is how early entrants can select 100L before resumption: publish their upcoming session **before** they select it. The profile shows precisely which session a correction belongs to. A 100L assigned to 2026/2027 stays 100L at the 2026 boundary; its first advancement is 7 November 2027. Changing the calendar later does not retag any saved level. An arbitrary far-future schedule cannot assign levels multiple years ahead.

The published Profile can still correct its own level under the existing column grants and own-row RLS, with the server assigning the session and timestamp. The newer Profile uses an own-profile RPC with a server-derived identity/time, a matching reviewed account, an allowed tier, a matching assignment year and a typed confirmation. The existing `get_effective_level(p_uid uuid)` signature is retained and now respects the caller's profile RLS. The updated Library reads it instead of the raw stored field; the older published Library filter does not until that frontend is updated. Explicit dashboard level and subsequent manual selections are not overwritten. Semester-default/dashboard/catalog changes are separate milestones.

## Operator checks

The live project returned `BOTH PROFILE EDITORS READY`. Use the [current Profile runbook](profile-level-rollout.md) for the two clients and the read-only schema check. The old plan to remove direct own-Profile writes before publishing has been retired. The manual session anchor and role flags are not browser-writable. A drift warning is not permission to change roles, restore the December formula or backfill levels.

For a different environment, verify backups, calendar permissions, the December function, existing writers and RLS before reviewing the compatible 007. Use only disposable tests for the November boundary, stale reviews and both editors. Do not reinstall unrelated signup, calendar or admin migrations to bypass a preflight. See the [frontend release checklist](paired-release.md); it never generates SQL.

## Local checks

`tests/academic/frontend.test.cjs` uses only Node built-ins. `tests/academic/database-smoke.mjs` runs the two exact migrations in a fresh, in-memory PostgreSQL engine under synthetic member/admin roles; it uses the already-pinned dependency in `tests/auth/package-lock.json` and no project credentials. `tests/academic/legacy-level-body.sql.txt` is a drift-check fixture for that test, not a migration. Run the existing auth and eye suites as regressions. The local browser rehearsal additionally tested the full-page flows with synthetic sessions and the real SQL functions, not the production Auth service or external mail.
