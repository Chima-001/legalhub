# One runtime semester desk

**`public/pages/semester.html` is the only dashboard layout.** For example, `pages/semester.html?level=300L&semester=first` and `pages/semester.html?level=100L&semester=second` open the same document. Choose a level on the landing page. On the desk, only the two semester tabs change the view in place; both stay within that level. **Switch level** is the original link to `../index.html#levels`, not a dropdown or an account-level change. Refresh, Back, Forward, ordinary links and opening a tab in a new window work. The old numbered page has been retired without a redirect. Use Home or bookmark the selected semester on this shared desk. No HTML generator, ten page copies, build step or package install.

## Where the courses come from

Home keeps its five level cards and two semester links. The fixed choices do not need their own database tables. **Admin settings → Curricula** creates named curricula. **Manage courses in this curriculum** opens Courses with the right curriculum selected. Choose the level and semester and add as many courses as needed. Multiple curricula can contribute to the same semester. A member can browse these courses but cannot change the catalogue.

`public.courses` is the canonical course table. The signed-in catalogue reader returns each listing's ID, curriculum, stable material key and scope. The desk, Upload Material and Library read it; a new course is visible even with zero approved books. A successful empty list is “not published yet”; a failed read is an error with Retry, never an excuse to show stale/fabricated listings. The Library still offers existing approved materials independently. Explicit scope, all-material links and manual filters remain available.

`public/data/semester-desks/index.json` and `100l-second.json` decorate the original eight listings with their authored layout, 26 resource rows, tiles, case/past-question links and CBT actions. Do not edit JSON to add a course to the directory; an admin does that in Settings. No curriculum is invented for those eight. An admin can assign each to an actual curriculum later. A rename preserves its slug, resource links and material key. Archiving hides it from new choices, without erasing files. A linked course cannot be hard-deleted. See `docs/curricula.md` for operator and test notes.

Serve the normal app at its established site mount. A local server pointed at the production database is **not** a test environment. Use the offline preview in the external handoff or the disposable tests for review; install no SQL just to see the design.
