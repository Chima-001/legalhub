# Release the frontend without replacing the published controls

**The previous paired 007/011 release plan is retired.** Do not prepare, paste or execute its generated SQL. Do not install the former `011-material-review.sql`. It would remove access the two Materials clients need. The old storage replacement that accepted *only* `remove-reviewed` would break both the published Reject and the Library delete control. Do not deploy it.

| Layer | Current contract | What to do for this release |
| --- | --- | --- |
| Materials and approved Library deletion | Existing admin RLS UPDATE for edits/approval; `r2-presign` `reject` with ID and key for both removals. | Publish the corrected frontend through the normal process. No SQL, new role or signer cutover. The old published UI can stay online. |
| Levels | Compatible 007 already active. Published direct own-profile saves and the new scoped RPC share the November reader. | No activation. Read-only status: `BOTH PROFILE EDITORS READY`. |
| Alert email | Existing outbox and JWT-verified notifier; `LegalHub` display name, configured mailbox and a link to the live Materials page. | No resend, credential change, transport reinstallation or additional hook. |

## Before and after frontend publication

1. Run `node tools/check-pr.cjs` on the candidate, using the pinned fixture dependency. The handoff runs it on the private candidate locally; no production services. The optional Chromium practice uses fictional admins, students and PDFs: `node tests/materials/browser/flow.mjs --practice` (see README for dependency and browser setup).
2. Review the actual base-to-branch diff and the hosting configuration, including which branches deploy. Push only `legalhub-update-v.3.0.0` and open a draft PR to the intended base. No force-push, automatic merge or migration hook. Review normal private CI and preview before production publication.
3. Publish the **complete** `public/` from the approved revision; do not mix pages and scripts from different revisions. `node tools/prepare-reviewed-release.cjs --check-site` is now **read-only**: it compares selected public assets and generates no SQL. A mismatch can mean the old frontend is still served; it does not disable the existing DB/signer contracts. `--prepare` refuses without network or output files.
4. After publication, sign in normally if you are the operator: an admin can open the queue or an approved item, choose the action, and click **No**; a student should not see admin controls. Check your own Profile effective level. Use a genuine upload/decision only for normal work, not a release smoke. For the next *natural* upload, verify display name/link and delivery privately. Do not replay the previous event. If necessary roll back the **static site** to the prior complete working deploy; neither backend repair depends on retiring the old client.

See [moderation and storage](materials-release.md), [level progression](profile-level-rollout.md), [email receipts](upload-notifications.md) and [offline boundaries](public-study-pwa.md).
