# Materials v3 · release and recovery

**Scope:** protect the actual moderation mutations and reconnect the existing `materials INSERT → notify-admins-on-upload → Resend` path. Do not test by uploading to the live project, deleting a real PDF, changing a real role or mailing real admins. A PR is reviewable before a production rollout.

**For the current mixed hosted/local release:** [paired release and local practice](paired-release.md). The old public admin and Profile pages still use direct writes. Do not turn off those writes under active old clients, and never add a fallback around review.

## 1. Before a production change

Confirm the project, current versions, intended private bucket, restorable database backup and separate R2 recovery plan. Preserve the current function and frontend artifacts for incident response. Coordinate a short maintenance window for uploads and moderation, including old tabs/integrations. PostgreSQL and R2 cannot be restored atomically. Stop on an unexpected grant, schema, Git or bucket difference; do not use a reset, a cascade or a broad grant to make checks pass.

Read-only inventory (no users, materials, dates or secrets):

```sql
SELECT to_regprocedure('public.lh_owner_admin_emails(uuid)') IS NOT NULL AS owner_reader,
       to_regprocedure('public.lh_material_change(uuid,uuid,text,text,text,jsonb)') IS NOT NULL AS review_rpc,
       to_regclass('legalhub_console.material_removals') IS NOT NULL AS removal_receipts,
       to_regprocedure('legalhub_console.dispatch_upload_alerts_due()') IS NOT NULL AS private_mail_dispatch,
       to_regclass('legalhub_console.upload_alerts') IS NOT NULL AS upload_events,
       to_regprocedure('public.get_my_level_context()') IS NOT NULL AS november_context;
SELECT t.tgname, t.tgenabled, n.nspname AS function_schema, p.proname AS function_name
FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE t.tgrelid='public.materials'::regclass AND NOT t.tgisinternal ORDER BY t.tgname;
```

**Privacy:** the inventory omits trigger arguments and headers. Share only names and status flags, never raw webhook definitions or secret values. Inventory Dashboard webhooks and **out-of-band integrations** too. If another sender/hook is already wired to this event, stop and reconcile it instead of adding a parallel one. If 011/012 are already installed, inspect the installed version and receipts; do not replay the SQL. Normal roles must not have access to the private console schema, Vault secrets, net queues or service credentials.

## 2. Coordinate the cutover (operator only)

1. **Upload alerts are already working on this project.** [Upload notifications](upload-notifications.md) records the two provider acceptances and explains the counts-only health query. Do not reinstall 012, create another hook, reset the ledger or redeploy the repaired mail worker to enable moderation.
2. **The new reviewer needs both a database transaction and the matching storage function.** Confirm R2 configuration, bucket recovery and allowed origins privately. The new `r2-presign` must be bundled with `removal.mjs` and retain JWT verification. Old removal clients and open tabs must stop before the coordinated switch.
3. **For LegalHub, use the [paired release guide](paired-release.md)**: verify recovery and the preview, stage the reviewed signer, publish the complete matching `public/`, then prepare and run the guarded 007 + 011 transaction. Do not paste 011 or 007 separately under the observed public frontend. This is a short window for the real app, not a prerequisite for the isolated practice desk. [Level behavior](profile-level-rollout.md).

## 3. What each confirmation authorizes

| Entry point | Required phrase and server effect |
| --- | --- |
| Pending → Edit → Save details | `i edit <current title>`. Review old title/file/scope and **new** title/level/semester/course. Only these four metadata fields can change. An unchanged legacy course is retained; a changed scope must be valid. No PDF mutation. |
| Pending → Approve | `i approve <current title>`. Only `pending → approved`. No new upload alert. |
| Pending → Reject | `i reject <current title>`. Permanently unlink this pending record, then remove its one verified R2 object. This is not a move to a rejected-items list. The former “remove rejected” branch was unreachable in the pending-only queue. |
| Approved Library → Delete | `i delete <current title>`. Same unlink/cleanup contract but **only for approved** material. No new access to other statuses or other admins’ tools. |

Each dialog binds a material UUID and the reviewed row’s `xmin` (a short-lived PostgreSQL row-version token, not a persistent ID). If the title is absent it shows the file name. Same-title items are still different records. The server checks the exact phrase and current status/version while holding locks; an edit between review and save fails rather than writing over it. The actor must still be an admin. Edit/approve check `auth.uid()`; removal verifies the signed-in user at the Edge and uses a service-only transaction that locks the current admin row. Cancel/Escape before submitting does not call a mutation. Once submitted, do not infer cancellation from closing a tab.

### A record and an object are not one transaction

Removal checks the actual row, uploader-prefix/key format, other references and unsafe deletion dependencies. It refuses shared/uncertain legacy keys and FK-blocked rows. It commits a private removal ticket and the row deletion **together, before calling R2**. A DB refusal cannot remove the PDF. The browser never chooses an object key for deletion. The ticket permanently retires that UUID/key and keeps cleanup retryable. Removing a record stops new download signing; links already issued cannot be recalled from recipients. GET URLs last up to an hour; PUT URLs last five minutes and are not single-use. Private R2 access is required.

- **“File cleanup is pending”** means the record has been removed; R2 deletion or the final receipt was not confirmed. Retry in the still-open reviewed dialog, or close and contact the operator. A successful retry skips any already completed ticket. A new admin does not get a generic key-deletion API.
- **Operator recovery** (only for an already authorized removal): list `material_id, removed_at` from `legalhub_console.material_removals` where `file_done_at IS NULL`. Privately reconcile the *one* ticket, its exact bucket/key and absence of any live material reference or active upload. After outstanding PUTs have expired, check for a late/recreated object as well. Complete only that previously approved key in R2, verify absence, then record completion via `public.lh_material_file_done(material_id, storage_path)` for that exact ticket using trusted operator credentials. Do not guess a key, delete a prefix, erase tickets or resurrect a row pointing at a missing file. Already-downloaded copies cannot be withdrawn. Reconcile old tombstones after the PUT window if late writers are suspected.
- An R2 transfer followed by an **unconfirmed insert** is different: check the record and object privately before retrying. An unlogged file is not a removal ticket. Never bulk-delete “orphans” as a smoke test.

## 4. Read the right receipt

Upload success confirms the stored PDF and the pending row, not mail. The private outbox captures commits; Edge HTTP status is transport evidence; the per-recipient provider ID records **acceptance**, not inbox delivery. [Activation, counts-only health SQL, retry rules and pause/recovery](upload-notifications.md). For incomplete R2 cleanup **after 011**, use `SELECT count(*) FROM legalhub_console.material_removals WHERE file_done_at IS NULL;` — unrelated to email.
