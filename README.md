# LegalHub

LegalHub is a study library for law students. Readers choose a level and semester on Home, browse the courses on that desk, and open approved PDFs. Signed-in members can submit a PDF for review. Admins maintain the term, curricula, courses and review queue.

The frontend is a static site under `public/`. Supabase Auth identifies the reader; PostgreSQL policies and narrowly granted functions control access. PDFs live in a private Cloudflare R2 bucket. The browser never needs a service-role, R2, webhook-signing or email-provider secret.

## Open the site locally

Serve the repository over HTTP (for example, VS Code Live Server) and open `/public/index.html`; use `/public/pages/login.html` for sign-in. If the server root is `public/`, use `/index.html` and `/pages/login.html`. Stay on the same host and port for the session. Do not use `file://`.

`public/scripts/auth/supabase-client.js` contains the **public** project settings. Private pages load that client before `auth-guard.js`. The guard hides protected content until it checks the session; the database, not that guard, authorizes data access. Use the verified Auth email for login and the recovery-email flow for a forgotten password. An optional self-reported registration number is not an official identity, an owner binding or a grant of admin rights. Keep confirmation/recovery redirects allowlisted for the intended origin.

**Live Server is not staging.** If the client points to the live project, uploading, publishing dates or changing a role there is a real operation. Use the disconnected tests below for development.

## Reader and admin workflows

| Start here | What to expect |
| --- | --- |
| **Home → Library** (`pages/pdf.html`) | An unscoped visit opens at the reader’s effective level, first semester. For example, a 300L reader gets 300L/first. A missing/failed level read does not invent a level. |
| **Semester desk → Library** | The desk wins: the same 300L reader arriving from the 500L/second desk sees 500L/second. Explicit all/semester/course selections, Relevant, shared items and later manual choices are respected. Published courses can appear before they have books. |
| **Upload Material** (`pages/materials.html`) | Choose the catalogue course or Relevant, type a title and select a PDF. Only a successful file transfer **and** a confirmed pending-row insertion produce “Constitutional Law Notes uploaded! Waiting for admin approval.” The title comes from the form, not the filename; success clears in seven seconds. If the transfer succeeded but the record is uncertain, check before retrying. Email delivery is not part of this receipt. |
| **Pending queue** | An admin reviews the current item and the exact phrase before editing its metadata, approving it, or rejecting and deleting it. Editing shows both the old item and proposed details. Approval publishes the row; it does not delete or resend the PDF. |
| **Approved Library item → ⋮ → Delete** | Only an admin can remove an approved item. The dialog identifies the title, file, scope, ID and effect. Cancellation, the wrong phrase, a changed version or lost authority cannot authorize the operation. Incomplete file cleanup is reported separately from removal of the database record. |
| **Admin settings** (`pages/admin-settings.html`) | Separate Term details, Curricula, Courses and restricted Admin access tools. Multiple named curricula can share a semester; courses have stable IDs/keys. Archive is not delete. Editing a term does not promote students. The wordmark goes Home; Back uses the actual referring page. |

Ordinary admins can maintain materials and the catalogue. Only the verified owner and designated role managers can manage admin access. Only the owner is permanently protected. The owner’s private list shows **emails of current admins the owner appointed**, not a directory. The private webhook targets eligible admin accounts for an upload; it does not expose or use the owner’s list. Keep deliberate operator-only SQL recovery separate from ordinary app workflows.

## What needs to be installed separately

A Git commit or hosted frontend does not install database migrations, deploy Edge Functions or verify an email sender.

- The existing auth/materials baseline uses `database/migrations/001`–`005` (see the actual filenames in the folder). `006-academic-calendar.sql` supplies the editable term and countdown. `008`–`010` provide the owner authority, named catalogue and private roster. **Do not replay them on an already configured project.** Do not run the migrations directory in bulk or use `database/dev/reset-test-signup.sql` during a release.
- `007-november-levels.sql` is a **separate owner release decision**. Its rule uses **7 November, Africa/Lagos**, independently of semester edits, with a 500L cap. An existing `get_effective_level(uuid)` alone does not prove the November rule is installed. See `docs/academic-calendar-release.md`.
- This release adds `011-material-review.sql` and `012-upload-alert.sql`. The latter connects **one** committed pending INSERT to the **existing** `notify-admins-on-upload` Edge Function and Resend. There is no browser mail call, backfill, second notifier or mail-on-approval trigger.
- **[Materials release and recovery runbook](docs/materials-release.md)**: rollout order (including old clients), R2 and sender configuration, read-only checks, failure handling and explicit operator gates. Review this before publishing either function, installing SQL or enabling uploads on a new environment. Offline storage of private books is not implemented by this release.

## Test without production services

Node 20+ and Git. From the repository root:

```sh
npm ci --prefix tests/auth --ignore-scripts --no-audit --no-fund
node tests/materials/check-release.cjs
```

The runner uses the real page handlers and migrations with local fixtures: upload receipts and consecutive messages, Library entry scope, permissions and stale writes, row/object cleanup, and per-recipient provider receipts and retries. Database cases use an in-memory PostgreSQL engine (PGlite); the webhook transport and mail provider are fakes. It does not read a project URL, deploy code, contact R2 or send mail.

Optional browser flow: install `tests/materials/browser` with `npm ci --prefix tests/materials/browser --ignore-scripts`, set `LEGALHUB_TEST_CHROME` to a **local** Chromium/Chrome executable and run `node tests/materials/browser/flow.mjs`. All browser requests are intercepted. It drives two fixture sessions from upload through review, Library deletion and fake mail acceptance. Run the project’s existing auth/academic/semester/admin regressions and normal CI before approving a merge. A passing fixture is not evidence of production inbox delivery.
