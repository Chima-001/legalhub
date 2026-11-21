# Enable students to set their own level

**Decision:** keep self-service level correction and the agreed 7 November progression together. The current profile UI already has a level selector and a reviewed save. It is intentionally read-only against the older database: a level reader alone cannot safely save a session-specific correction. Waiting, installing the PWA, pushing Git, or granting somebody admin is not the fix.

## Owner checklist — one project, one existing migration

1. Confirm the intended Supabase project, a restorable backup, the current frontend release, any other level writers and a coordinated window. No real account or private data is needed for a rehearsal. For this project, the earlier calendar and owner/catalogue work has already been installed; **do not rerun it**.
2. In SQL Editor run **`database/checks/profile-level-status.sql`**. It reads catalogue metadata only. `LEVEL EDITOR READY` means skip installation. `STOP: REVIEW LEVEL SCHEMA` or any error means stop; do not drop objects or loosen grants. `READY TO REVIEW 007` identifies the reviewed old database, **not approval to change it**.
3. Review the effect before proceeding: existing saved tiers are treated as **2025/2026** anchors, not dated from signup or last edit. Once 7 November 2026 in Lagos has passed, an existing 200L on that baseline can immediately **display 300L** on the next read. 500L stays 500L. There is no bulk promotion write. A missing tier is not promoted just because the display falls back to 100L. See `docs/academic-calendar-release.md` for the full rules and legacy compatibility.
4. Only if the project, backup and effect are approved: run **only the unchanged `database/migrations/007-november-levels.sql`** as one complete file in SQL Editor. It is independent of material moderation/alerts (011/012). It is not a new 013 migration. Nothing in the Git installer executes SQL. Run the status query again; expect `LEVEL EDITOR READY`. If the API schema cache has not refreshed, the operator can issue `NOTIFY pgrst, 'reload schema';` once, then reload the updated Profile page **while online**. Do not rerun 007 to refresh the API. The status receipt verifies the database, not an active browser or public deployment.

## What the student sees

Open **Profile → Current level**. Select 100L, 200L, 300L, 400L or 500L; choose Save, check the displayed academic session, type the displayed confirmation and confirm. The level belongs to the signed-in student. No admin, correct registration-number guess or repeated setting at each visit is required. Home → Library uses the effective level; visiting another level’s desk is browsing, not changing Profile. The value is for study defaults, not an academic credential.

An upcoming session already published when a level is assigned may be its anchor. A new 100L assigned to 2026/2027 first advances on 7 November 2027, not at the start of that same session. A changed session, account switch, failed read or lost connection must not turn into an unchecked direct table write. No edits are stored or queued offline. Do not change a real student’s level just to verify installation.
