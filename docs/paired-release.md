# Release the material reviewer and Profile together

## What failed, and where

The updated material UI calls `lh_material_review(actor, item)` before showing Approve or Reject. The live project had neither that routine nor its write/cleanup service. An existing admin could therefore get the generic verification error even though their role hadn't changed. The new UI distinguishes an unavailable server version, a server authorization refusal, a stale item and an uncertain response; it **never** falls back to `.update()` or raw file deletion. An HTTP cache refresh cannot create a missing routine.

The currently observed public Materials page uses its old direct updates and old storage action. The old Profile page also writes level columns directly. Local Live Server uses **the same hosted backend** when configured with this project's public URL. Installing 011/007 before retiring those old clients would fix one UI while breaking the other. The checks below distinguish files installed in Git, a running Edge function, database contracts, and provider receipts. The email incident is repaired independently; see [the actual mail receipt](upload-notifications.md).

## Work locally now, without touching the three pending real records

From the real repository, `node tools/check-pr.cjs` runs the material/level suites and the existing auth, admin, curriculum and PWA regressions without production services. For the interactive practice desk on Windows (Chrome/Edge installed):

```powershell
npm.cmd ci --prefix tests/materials/browser --ignore-scripts --no-audit --no-fund
node tests/materials/browser/flow.mjs --practice
```

The second command opens a dedicated browser with the **actual** admin queue, student Profile and student upload pages backed by a disposable local PostgreSQL engine. Two fictional items are ready to approve/reject. Type the exact confirmation; after a student upload reload the admin tab. Use the Profile tab to correct a level for the displayed session. This practice mode is for these flows only; auth, storage IO and mail are doubles. It is not your live admin session and it won't deliver an email. Close its browser or press Ctrl+C to discard it. If Chrome/Edge cannot be found, set `LEGALHUB_TEST_CHROME` to its local executable. Running the normal app via Live Server is **not** this isolated mode. The automated `--practice-smoke` runs the same setup headlessly and tests moderation and level correction through the real pages.

## Draft PR is not deployment

Review the full feature diff against the intended base, the clean branch and any auto-publish hooks. Run the normal private CI, then push the feature branch and open a **draft** PR. No automatic merge. The Git helper does not deploy, run production SQL or send notifications. The README-only change stays at the tip.

## Live switch — one coordinated window, not an installer to run now

1. **Protect the current service.** Confirm a restorable DB backup, a separate private R2 recovery plan, the previous frontend deploy and the current functioning `r2-presign` artifact. Save any downloaded function in a separate directory, not over this checkout. Compare the old signer against your previous reviewed source. If an unknown production change exists, reconcile it first. Verify the new client on a preview deploy. Pause uploads, moderation and Profile level saves for **all affected users**; notify students and admins, have them close old tabs and stop old integrations. If you cannot coordinate active writers, do not switch the signer, site or grants. The site and database cannot switch atomically across providers.
2. **Deploy the matching R2 function** from the reviewed checkout with **both** `supabase/functions/r2-presign/index.ts` and `removal.mjs`, via the official bundling CLI: `supabase functions deploy r2-presign --project-ref iyeekpmutpugpmarddpa`. Keep `verify_jwt` on (check config and deployed metadata); never use `--no-verify-jwt` or paste the entry file alone. The three top-level SDK imports are pinned to the versions exercised locally; no declaration-only package is executed at startup. It keeps signed upload/download and server authorization, and accepts only reviewed removal. A no-event GET on the running worker must return 405 and `X-LegalHub-Storage-Contract: reviewed-removal-v1`. The generated SQL verifies that from the private project before it acquires the application table locks. A 401 to an unsigned request only proves the gateway. No real object operation is needed. Do not redeploy the working notifier.
3. **Publish the complete matching `public/`** over HTTPS at the real site (not just a branch-preview URL or Live Server). Until the database switch the new editors can report unavailable: keep reviews/level saves paused. An upload into a site pointing at this project is a live upload even from localhost. From the same checkout, prepare the operator SQL in a new file outside the repo:

   ```powershell
   $sql = Join-Path $env:TEMP ("LegalHub-go-live-" + [guid]::NewGuid().ToString('N') + '.sql')
   node tools/prepare-reviewed-release.cjs --prepare "$sql"
   ```

   It performs read-only, unauthenticated public GETs and compares the served UI, review, Profile and PWA assets with your checkout. It **refuses** old/rewritten/partial responses, redirected files and wrong content types (including modules served as plain text). For HTML alone it allows the exact inert Netlify attribution comment observed immediately after the charset declaration; it does not strip arbitrary comments or markup. It writes no file on failure. `--check-site` only compares the public files. Do not bypass a mismatch, overwrite a different SQL file, or paste secrets into the generator.
4. **Activate once.** Read the generated SQL, then in the intended project's private SQL Editor run it as one complete transaction within 90 minutes. It validates the project, absence of 007/011 and expected old guards, plus the running R2 contract. It uses the hash-pinned contents of the unchanged reviewed `007-november-levels.sql` and `011-material-review.sql`, verifies the expected new function bodies/grants, and checks that existing user/material row versions were untouched. If either half fails before commit, both database changes roll back. There is **no** reinstallation of 008–010, 012, Vault, Cron or any recovery/reset script. Never rerun a failed fragment or loosen the gates. If either migration is already present, stop for a targeted status review.
5. **Confirm and reopen.** Expect `MATERIAL DATABASE READY / LEVEL EDITOR READY`. `database/checks/material-review-status.sql` and `database/checks/profile-level-status.sql` are independent read-only postchecks. Reload the updated frontend: an admin can open the real review then **Cancel** (no mutation); a student can see their own effective level and session without saving. Use the local fixture for destructive cases. Gateways, provider receipts and inbox delivery are separate from those checks. No one should reject an actual PDF or change a real role simply to test a release.

The owner wants all existing recorded levels advanced immediately under the agreed 7 November Lagos rule, capped at 500L; manual Profile changes by the signed-in student remain available. The pre-release count was **44/44 profiles displaying differently** under the new reader. Their stored baselines are not overwritten. This takes effect *when 007 commits*, not on Git push or on installing this kit. A fresh manual correction is anchored to its session and doesn't immediately double-promote.

If the cutover stops, keep writes paused and read the first failing gate. If the DB never switched, restore the previous matching hosting/function release if necessary. Once the DB **has** switched do not roll just the old deletion client/signer back onto the new schema: use a reviewed forward fix, or the coordinated DB + separate R2 recovery plan. Restoring only a DB row cannot restore a deleted PDF.

### Optional Edge regression (no production accounts)

In an isolated development environment with Deno, warm its dependency cache first. Run `deno check` on both real `index.ts` files. `tests/materials/edge/boot.mjs` boots the R2 entry with its actual SDK imports and synthetic configuration. `tests/materials/edge/r2-smoke.mjs` plus its adjacent `import_map.json` exercises the handlers with a fake Supabase client and intercepted S3 deletion. Use an empty test HOME/USERPROFILE, cached packages, no network permission or real AWS configuration. The browser, Deno/import-map and SQL suites prove different layers; none logs into a production administrator or proves the hosted SDK loaded. The production no-op GET gate is still required.
