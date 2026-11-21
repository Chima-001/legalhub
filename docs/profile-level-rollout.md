# Student levels: 7 November, Africa/Lagos

**Live on the LegalHub project. No production SQL to run for this release.** The compatible version of the existing `database/migrations/007-november-levels.sql` keeps the published Profile and the new Profile working on the same database. The live metadata check returned `BOTH PROFILE EDITORS READY`. Immediately after activation, the reader returned the next tier for **44 of 44 existing profiles**, without rewriting their saved tiers or using real accounts for test saves.

## What the student sees

The effective level is calculated on read, not by a yearly bulk edit. Old recorded levels without an anchor start in **2025/2026**, regardless of signup date. For example, a saved 200L on that baseline becomes 300L on 7 November 2026 at Lagos midnight. 500L is the ceiling. A student with neither a recorded tier nor a recognised older library tier gets a 100L display fallback, not an invented baseline to promote.

- **Existing published Profile:** next online load reads `get_effective_level`. Its Save still updates only the signed-in student's level fields under the existing grants and own-row policy. A server trigger validates the tier and sets the assignment session and timestamp. Writing the same stored tier is still a real correction for the current session.
- **New Profile:** choose 100L–500L, review the assignment session, then confirm the displayed **personal level** phrase. The server accepts only the current account, expected assignment session and matching confirmation. A stale review needs reloading. No admin action, registration-number match or repeated manual promotion is required.
- A session already published one year ahead can anchor a new assignment. It does not move an existing anchor back and forth as the calendar is edited. The two clients read the same correction. Neither can directly write `level_base_year` or `is_admin`. Browsing a desk is not a level save; there is no offline edit queue.

The older hosted **Library filter** is a separate consumer: it reads the stored tier directly. It gains the effective-level, first-semester Home default when the updated frontend is published. The online **Profile** on the existing site already reads the effective level.

Operators: `database/checks/profile-level-status.sql` reads schema metadata only. On this project, **do not replay 007** or restore the old restrictive writer grants. For separate environments, inventory their calendar, own-row access, role grants and December reader first. A different schema or `STOP` needs review, not forced execution. `tests/academic/profile-rollout-smoke.mjs` exercises both write paths, stale/account/tier refusals and row preservation with fictional students.
