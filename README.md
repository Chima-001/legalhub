# LegalHub

LegalHub is a study library for law students. Readers choose a level and semester on Home, browse the courses on that desk, and open approved PDFs. Signed-in members can submit a PDF for review. Admins maintain the term, curricula, courses and review queue. The installable site also has a public study field guide for use without a connection.

The frontend is a static site under `public/`. Supabase Auth identifies the reader; PostgreSQL policies and narrowly granted functions control access. PDFs live in a private Cloudflare R2 bucket. The browser never needs a service-role, R2, webhook-signing or email-provider secret.

## Open the site locally

Serve the repository over HTTP (for example, VS Code Live Server) and open `/public/index.html`; use `/public/pages/login.html` for sign-in. If the server root is `public/`, use `/index.html` and `/pages/login.html`. Stay on the same host and port for the session. Do not use `file://`.

`public/scripts/auth/supabase-client.js` contains the **public** project settings. Private pages load that client before `auth-guard.js`. The guard hides protected content until it checks the session; the database, not that guard, authorizes data access. Use the verified Auth email for login and the recovery-email flow for a forgotten password. An optional self-reported registration number is not an official identity, an owner binding or a grant of admin rights. Keep confirmation/recovery redirects allowlisted for the intended origin.

**Live Server is not staging.** If the client points to the live project, uploading, publishing dates or changing a role there is a real operation. Use the disconnected tests below for development.

## Install LegalHub and study offline

On your first ordinary online **Home** visit after this update, LegalHub offers to install once the page is ready. Choose **Install LegalHub** if your browser offers it, **How to install** for menu instructions, or **Not now**. The invitation won't return on your next visit, even if you just navigate away. This is a browser preference, not an account setting. A fresh profile or cleared site data can show it again. You can still install later from **Offline study guides**.

Open **Home → Offline study guides** (or `study/`) once while connected. Wait for **Public guides ready on this device**. Use **Install LegalHub** when offered or the browser’s Add to Home Screen menu. A supported browser can use a bookmark instead. HTTPS or localhost is required for the service worker; installing the app is not a new account or a substitute for signing in.

| After preparation, without internet | Online only |
| --- | --- |
| Read the three public guides: **brief a case**, **apply a rule to a problem**, and **check a source**. Their exercises, layout and icons work offline. An ordinary Home launch offers a link to the guides, not a cached dashboard. | Sign-in and recovery, Profile and level edits, semester desks and calendar, live catalogue/Library, uploaded PDFs and signed links, uploads, admin settings, moderation and upload notifications. No edits or submissions are queued to replay later. |

The manifest defines the app name/icons/start URL. `public/sw.js` stores only six bundled public assets. It never saves a live page or API response. Nothing private is added to the offline pack, even after an admin visits the site. A first-ever offline visit cannot install it, and clearing site data can require another online visit. See the [public study and PWA guide](docs/public-study-pwa.md) for device behavior, updates, hosting and recovery.

## Reader and admin workflows

| Start here | What to expect |
| --- | --- |
| **Home → Library** (`pages/pdf.html`) | An unscoped visit opens at the reader’s effective level, first semester. For example, a 300L reader gets 300L/first. A missing/failed level read does not invent a level. |
| **Semester desk → Library** | The desk wins: the same 300L reader arriving from the 500L/second desk sees 500L/second. Explicit all/semester/course selections, Relevant, shared items and later manual choices are respected. Published courses can appear before they have books. |
| **Profile → Current level** | A signed-in student can choose or correct **their own** 100L–500L tier for the displayed session on the live level service. The new Profile reviews the session before saving; the older own-Profile save still works. If the level is already right, leave it alone. Browsing a different level’s desk does not change Profile. |
| **Upload Material** (`pages/materials.html`) | Choose the catalogue course or Relevant, type a title and select a PDF. Only a successful file transfer **and** a confirmed pending-row insertion produce “Constitutional Law Notes uploaded! Waiting for admin approval.” The title comes from the form, not the filename; success clears in seven seconds. If the transfer succeeded but the record is uncertain, check before retrying. Email delivery is not part of this receipt. |
| **Pending queue** | Choose Edit / Approve / Reject, then **Yes or No**. No typed title. A saved edit affects the selected metadata; approval publishes without deleting the PDF or sending another alert. Rejection removes the pending row and its PDF. |
| **Approved Library item → ⋮ → Delete** | Only an admin sees Delete. The **Yes/No** confirmation identifies the selected item. No keeps it; Yes uses the existing server-checked material ID and storage key. An uncertain response is not success. |
| **Admin settings** (`pages/admin-settings.html`) | Separate Term details, Curricula, Courses and restricted Admin access tools. Multiple named curricula can share a semester; courses have stable IDs/keys. Archive is not delete. Editing a term does not promote students. The wordmark goes Home; Back uses the actual referring page. |

Ordinary admins can maintain materials and the catalogue. Only the verified owner and designated role managers can manage admin access. Only the owner is permanently protected. The owner’s private list shows **emails of current admins the owner appointed**, not a directory. The private webhook targets eligible admin accounts for an upload; it does not expose or use the owner’s list. Keep deliberate operator-only SQL recovery separate from ordinary app workflows.

## What needs to be installed separately

A Git commit or hosted frontend does not install database migrations, deploy Edge Functions or verify an email sender.

- The existing auth/materials baseline uses `database/migrations/001`–`005` (see the actual filenames in the folder). `006-academic-calendar.sql` supplies the editable term and countdown. `008`–`010` provide the owner authority, named catalogue and private roster. **Do not replay them on an already configured project.** Do not run the migrations directory in bulk or use `database/dev/reset-test-signup.sql` during a release.
- **[Materials and Library moderation](docs/materials-release.md)** use the existing admin RLS update and verified `r2-presign` ID/key removal. No new moderation SQL, typed title or signer deployment is required. Typed confirmations in Admin Settings remain. The earlier paired-release runner now only [compares published files](docs/paired-release.md); it cannot generate activation SQL.
- **[Student levels](docs/profile-level-rollout.md)** are live. Existing saved 2025/26 baselines advance on **7 November in Lagos**, up to 500L. Existing and new Profile clients can correct the signed-in student's tier without a mass rewrite. The server anchors the correction to avoid double promotion. Do not replay 007.
- **[Upload notifications](docs/upload-notifications.md)** use the configured sender with the display name **LegalHub** and link directly to the Materials page. One earlier upload had two provider acceptances; the owner confirmed one inbox. The new format was verified without sending or replaying an alert. Approval doesn't send mail. Do not reinstall 012 or add another hook.

## Test without production services

Node 20+ and Git. From the repository root:

```sh
npm ci --prefix tests/auth --ignore-scripts --no-audit --no-fund
node tools/check-pr.cjs
```

The coordinated check also requires the earlier sign-in/recovery/signup, confirmation, owner authority, catalogue and private roster suites from the full feature branch. Its `tests/pwa/check-release.cjs` stage checks the six-file public pack, worker rules, Profile UI, read-only status check and 007 after the existing admin schema. It also runs `tests/materials/check-release.cjs`, which checks upload receipts and consecutive messages, Library entry scope, admin permissions, stale edits, Yes/No cancellation and confirmed ID/key deletion, and per-recipient provider receipts and retries. Database cases use an in-memory PostgreSQL engine (PGlite); the webhook transport and mail provider are fakes. It does not read a project URL, deploy code, contact R2 or send mail.

For an interactive, **disposable** admin queue and student Profile/upload, run `node tests/materials/browser/flow.mjs --practice` after installing the browser test dependency below. It uses the real page handlers and reviewed database logic, without a real login, R2 object, recipient or production connection. This is separate from Live Server.

Optional real-browser tests: install the existing browser test dependency with `npm ci --prefix tests/materials/browser --ignore-scripts`, then set `LEGALHUB_TEST_CHROME` to a local Chromium/Chrome executable. `node tests/pwa/browser-smoke.mjs` uses a loopback-only site and a **real service worker** to test the one-time Home invitation (including two competing tabs and simulated native install choices), offline relaunch, privacy, both hosting mounts and a version update. `node tests/materials/browser/flow.mjs` exercises intercepted material review and fake mail acceptance. Neither needs production secrets. Run the project’s normal regressions and CI before approving a merge. A passing rehearsal is not a live deployment or an inbox test.
