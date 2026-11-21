# One runtime semester desk

**`public/pages/semester.html` is the only dashboard layout.** For example, `pages/semester.html?level=300L&semester=first` and `pages/semester.html?level=100L&semester=second` open the same document. Choose a level on the landing page. On the desk, only the two semester tabs change the view in place; both stay within that level. **Switch level** is the original link to `../index.html#levels`, not a dropdown or an account-level change. Refresh, Back, Forward, ordinary links and opening a tab in a new window work. The old numbered page has been retired without a redirect. Use Home or bookmark the selected semester on this shared desk. No HTML generator, ten page copies, build step or package install.

## Where the content comes from

1. Home’s level/semester links select `100L`–`500L` and `first` or `second`. The desk uses the existing account guard. A bare, ambiguous or unknown selection shows a message and the return-to-Home link. It does not guess a level, display semester tabs or offer a second level chooser.
2. `public/data/semester-desks/index.json` describes each level and names the semesters with confirmed lists. Entries in `published` mean **course directories**, not published academic-calendar dates. A calendar is not needed to browse either semester.
3. Only the selected published list is requested: e.g. `public/data/semester-desks/100l-second.json`. Unlisted terms use the index alone. The eight supplied courses and 26 authored resource rows belong to 100L second only. “Course list not published yet” does **not** mean the library has no books. Failed/invalid published files have a retry state instead, with no invented count.
4. `public/scripts/academic/desk-data.mjs` validates the selection and payload, deduplicates loads and caches successful results for this document. `semester-desk.mjs` fills the HTML shell’s native `<template>` components; a late reply can’t overwrite a newer selection. Each desk’s stars/recent list stays in that document’s memory, never written to a profile. The carousel, greeting, avatar, glass styles, resource links and course requests retain their established roles. Library links include level, semester and, where supplied, the course filter.

## Add a confirmed list without adding a page

- Place one JSON data file `public/data/semester-desks/<lowercase-level>-<semester>.json`, e.g. `300l-first.json`. Set `level` to `300L`, `semester` to `first`, and put the owner-confirmed entries in its `courses` array. Then add `"first"` to `300L.published` in the index and deploy both data files together. **Do not copy 100L courses as placeholders.** An unlisted term needs no file. Remove a semester from the index to mark its list unpublished; no changes to existing material records.
- A course needs `id` (unique lowercase slug starting with a letter) and `name`. Optional: `title` for full heading, `code`, `tileCode`, six-digit hex `accent`, `badge`, `badgeActive`, `request` and `resources`. Keep authored distinctions between a short name, full title, tile code and library query. Omit unknown counts instead of inventing values.
- Omitted `resources` gives a course-scoped library link; an empty array gives “No resources listed yet.” A resource uses `label`, plus optionally `library` (course query) **or** `href`, `count`, `live`, `copy`. A label with neither destination remains plain text. Local `./page-name.html` URLs and the established HTTPS CBT origin are supported. Optional `indexOrder` lists each ID exactly once. Up to two `guides` (`title`, `note`, `href`, `tone`) can precede the shared library/CBT links. See the real 100L file for examples.
- This is public, curated catalogue **metadata**, not protected document storage. Do not put secrets, private student details or signed download URLs here. The existing PDF library retrieves authorised materials separately. The uploader’s independent suggestions, backend permissions, admin calendar and academic-level rules are unchanged by the switch to runtime rendering.

## Check locally

From the repository root with Node 18+:

```sh
node --test tests/semester/level-desks.test.cjs tests/semester/library-filters.test.cjs
```

Serve the checkout or `public/` over HTTP (e.g. VS Code Live Server), not `file://`. Sign in normally; use Home → Choose your level → 100L → Second semester, or open its canonical URL above. Switch between semesters, then try Back and Refresh. Use **Switch level** to return to the Levels section on Home and pick a different level there. Academic-calendar SQL is **not** a prerequisite for this desk. There is nothing to regenerate after a data edit; refresh the browser to load a fresh catalogue.
