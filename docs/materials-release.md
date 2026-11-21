# Materials v3 · release and recovery

**Scope:** protect the actual moderation mutations and reconnect the existing `materials INSERT → notify-admins-on-upload → Resend` path. Do not test by uploading to the live project, deleting a real PDF, changing a real role or mailing real admins. A PR is reviewable before a production rollout.

## 1. Before a production change

Confirm the project, current versions, intended private bucket, restorable database backup and separate R2 recovery plan. Preserve the current function and frontend artifacts for incident response. Coordinate a short maintenance window for uploads and moderation, including old tabs/integrations. PostgreSQL and R2 cannot be restored atomically. Stop on an unexpected grant, schema, Git or bucket difference; do not use a reset, a cascade or a broad grant to make checks pass.

Read-only inventory (no users, materials, dates or secrets):

```sql
SELECT to_regprocedure('public.lh_owner_admin_emails(uuid)') IS NOT NULL AS owner_reader,
       to_regprocedure('public.lh_material_change(uuid,uuid,text,text,text,jsonb)') IS NOT NULL AS review_rpc,
       to_regclass('legalhub_console.material_removals') IS NOT NULL AS removal_receipts,
       EXISTS (SELECT FROM pg_extension WHERE extname='pg_net') AS pg_net,
       to_regclass('legalhub_console.upload_alerts') IS NOT NULL AS upload_events,
       to_regprocedure('public.get_my_level_context()') IS NOT NULL AS november_context;
SELECT t.tgname, t.tgenabled, n.nspname AS function_schema, p.proname AS function_name
FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE t.tgrelid='public.materials'::regclass AND NOT t.tgisinternal ORDER BY t.tgname;
```

**Privacy:** the inventory omits trigger arguments and headers. Share only names and status flags, never raw webhook definitions or secret values. Inventory Dashboard webhooks and **out-of-band integrations** too. If another sender/hook is already wired to this event, stop and reconcile it instead of adding a parallel one. If 011/012 are already installed, inspect the installed version and receipts; do not replay the SQL. Normal roles must not have access to the private console schema, Vault secrets, net queues or service credentials.

## 2. Coordinate the cutover (operator only)

1. **Prepare secrets privately.** Check `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` on the existing `r2-presign` function. Keep the bucket private; allow only intended web origins and the necessary PUT/GET/HEAD and `Content-Type` in R2 CORS. CORS is not authorization. Bucket permissions must support the intended get/put/delete operations. Do not use Supabase Storage for these PDFs. For the existing `notify-admins-on-upload` function configure `RESEND_API_KEY`, **`RESEND_FROM` on a sender/domain verified with Resend for actual recipients**, and `UPLOAD_WEBHOOK_SECRET`. Supabase Auth SMTP settings do not configure this sender. Generate the webhook secret privately as 32 random bytes encoded as 64 lowercase hex characters. Do not use a sample, put it in SQL history, commit it or send it in chat.
2. **Deploy the two reviewed functions to the confirmed project**, including their sibling `.mjs` modules (`supabase functions deploy r2-presign --project-ref <confirmed-ref>` and `supabase functions deploy notify-admins-on-upload --project-ref <confirmed-ref>`). Keep gateway JWT verification **on** for both. Disable the old unreviewed R2 removal handler **before** installing 011: the old service-role function could bypass browser grants. Until 011 is in place the new reviewed action fails closed. Use a coordinated window, not a mixed-version public test. If deploying via Dashboard, do not paste only `index.ts` and omit its import.
3. **After approval, install only `database/migrations/011-material-review.sql`** once, in the intended project’s SQL Editor. Expect `MATERIAL REVIEW READY` after commit. It removes direct web UPDATE/DELETE on `materials` while keeping authenticated pending INSERT and existing reads. Existing row contents, uploaded files, roles, catalogue and calendar are not backfilled or changed. Old direct edit/approve clients must be retired. Do not run 008/009/010 or owner activation again.
4. **Prepare the one webhook.** Enable `pg_net` in Database → Extensions under the project’s normal security review. It should expose `net.http_post`; the runbook assumes `extensions.hmac` (pgcrypto) and private Vault already exist. In Vault’s dashboard create these three named entries without putting the values in a migration or terminal history:

   | Vault name | Value |
   | --- | --- |
   | `lh_upload_project_ref` | The confirmed ref of this very project. The function URL is built for this ref only. |
   | `lh_upload_anon_jwt` | This project’s currently valid **legacy anon JWT** for the verifying Edge gateway. Not a service-role key, personal access token or `sb_publishable_…` string. If unavailable, stop and review gateway configuration separately; do not turn off verification. |
   | `lh_upload_hook_secret` | Exactly the same private 64-character value as `UPLOAD_WEBHOOK_SECRET` on the function. |

   The queue carries the anon JWT plus a short-lived HMAC over the committed material ID and timestamp, **not** the signing secret, an admin address or a PDF URL. The handler verifies it before reading a recipient. When rotating the signing secret, coordinate both stores and replay only affected captured events.
5. **After approval, install only `database/migrations/012-upload-alert.sql`.** Expect `UPLOAD WEBHOOK INSTALLED`. Installation neither sends mail nor replays old rows. It creates **one** AFTER INSERT trigger for pending materials; do **not** also create a Dashboard webhook, add a frontend function invocation or schedule a second sender. It refuses unexpected insert triggers. Failed preflight/DDL rolls back that file, not earlier separately committed changes. If alerts are a release requirement, keep uploads paused until this wiring and sender are ready.
6. **Publish the reviewed frontend from `public/`**, with all JS modules at their relative paths. Run normal branch CI and review hosting settings; pushing a branch is not proof of a Netlify release. Reopen uploads/moderation only at the agreed cutover. Use read-only checks and observe the next *naturally occurring* upload in normal operation; no real-person test mail or sacrificial PDF is required. Decide on 007 separately: explicitly defer annual progression, or schedule its own reviewed rollout. Do not advertise the November rule as live just because the Library can read a level.

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

## 4. Understand the mail receipt

At each new pending INSERT the database records the material ID, truncated display title/course and intended **admin IDs**, then queues the signed event for delivery **after commit**. Rolled-back uploads, edits and approvals do not notify. The function rechecks admin status and uses the current confirmed, active Auth email at claim time. It sends one plain-text message per intended admin, privately; it does not expose a roster or include a signed material link. There are no real addresses in the source and no requirement to have exactly two admins.

`accepted` means Resend returned success **and** an ID was recorded. It is not proof of inbox delivery. An unverified sender, missing configuration, DB read failure, HTTP rejection, timeout or ambiguous response is not counted as acceptance. An unavailable recipient or an upload with no admin recipients is not reported as a successful notification. Check delivery/bounce status in the provider’s console separately.

Operator health checks below show counts, not addresses or secrets. Use only **after** 011/012 are installed:

```sql
SELECT count(*) FILTER (WHERE file_done_at IS NULL) AS files_awaiting_cleanup
FROM legalhub_console.material_removals;
SELECT count(*) AS captured_uploads,
       count(*) FILTER (WHERE dispatch_failed) AS could_not_enqueue,
       count(*) FILTER (WHERE NOT EXISTS (SELECT FROM legalhub_console.upload_alert_targets t WHERE t.material_id=e.material_id)) AS no_targets
FROM legalhub_console.upload_alerts e;
SELECT outcome, count(*) FROM legalhub_console.upload_alert_targets GROUP BY outcome;
```

If pending persists, join the event’s `net_request_id` privately to `net._http_response.id` for `status_code`, `timed_out` and time; these transient transport logs are not the delivery ledger. A queue ID is not an HTTP success. A provider 4xx (including sender rejection), rate limit, timeout or missing secret needs attention. In this implementation there is **one automatic dispatch per committed upload**, not an automatic retry scheduler. Monitor the counts; fix the cause, allow the 90-second claim lease to expire, then an operator may requeue **one previously captured real event** via `legalhub_console.dispatch_upload_alert(the_material_uuid)`. This is a real delivery action, not a test. A NULL request ID means dispatch failed; do not loop blindly.

Retries skip stored acceptances and use the same Resend `Idempotency-Key` per upload/admin. An ambiguous first send older than **23 hours** or a changed destination requires operator reconciliation rather than an automatic resend beyond the provider’s 24-hour window. Reconcile against provider activity before acknowledging any missing receipt. No original targets means there is no historic audience to replay to. Do not broaden the recipients, add a second hook, or resend to admins who already have a receipt. If notifications must be paused, disable only `lh_material_upload_alert` in a separately approved change **and pause uploads**: inserts while it is disabled are not captured. Do not roll back to the old unchecked notifier or old file-deletion handler. Retain private receipts under the operator’s retention policy; do not prune them casually and then replay events.

References: [Supabase pg_net and post-commit requests](https://supabase.com/docs/guides/database/extensions/pg_net) · [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys).
