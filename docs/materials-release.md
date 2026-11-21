# Materials and Library: Yes/No moderation

| On this page | Yes | No or Escape |
| --- | --- | --- |
| Materials → Pending → **Edit → Save details** | Save the selected title, course, level and semester. The upload stays pending; the PDF is not replaced. | No database or storage change. |
| Materials → Pending → **Approve** | Publish that item in the Library. No new upload alert. | Leave the item pending. |
| Materials → Pending → **Reject** | Permanently remove that upload and its PDF. | Keep the record and PDF. |
| Library → approved item → **⋮ → Delete** | Permanently remove that item and its PDF. | Keep the item in the Library. |

There is no typed title on either page. Admin Settings' own term, catalogue and access confirmations are unchanged. A title describes the item; it is not its identifier.

## Server paths already used by the published pages

- **Edit and approve:** authenticated `UPDATE public.materials`; the existing admin RLS policy is the authority. The updated UI rereads the current account, role and row, applies conditions to the update itself and requires the returned ID. A stale form or a zero-row update is not a success.
- **Both removals:** the browser invokes the existing JWT-verified `r2-presign` with `{action: 'reject', materialId, key}` after confirmation. Pending vs. approved is checked in the new UI. It checks that the displayed row still matches and that its unique PDF key belongs to the recorded uploader. The storage function checks the user, current admin flag and exact row/key; the service credential stays on the server. The new UI requires `{deleted: true}`. It never issues a direct table delete. The repository signer additionally verifies the uploader path, state and unique key, and confirms the row returned from deletion. This release does **not** require redeploying the running signer.
- Upload signing, the pending insert, approved/member and admin downloads, and the ordinary catalogue are separate. Do not change a role or grant browser DELETE to repair the UI. No moderation migration, title-review RPC, cleanup ledger or second upload hook is needed.

## If an operation isn't confirmed

Reload the queue or Library before trying again. An R2 deletion and a database deletion are separate operations, not one transaction. The legacy signer removes the object first. A timeout or row-delete failure is not proof that both are intact or that both were deleted. An operator should privately reconcile the **specific ID and key**, current references, object and logs; do not retry blindly, delete a prefix or remove other rows. Already-issued signed URLs/copies cannot be recalled by the UI. A transfer followed by an uncertain *insert* is different: reconcile that upload, not the moderation action.

`database/checks/material-review-status.sql` is metadata-only. `MATERIALS YES/NO DATABASE READY` indicates the expected grants, row policies, admin predicate and catalogue hook. It is not an authenticated R2 operation or a test on an actual admin's item. A `STOP` is a reason to inspect drift, not to widen grants. Use disconnected fixtures for destructive checks. See [release notes](paired-release.md) and [upload mail](upload-notifications.md).
