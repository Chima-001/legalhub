# LegalHub

LegalHub is a browser-based legal resources application using Supabase for authentication and user data.

## Run Locally

1. Open the `legalhub` folder in VS Code.
2. Start the project with the VS Code Live Server extension.
3. Open `public/index.html` with Live Server, then visit `pages/login.html`, for example:

	`http://127.0.0.1:5500/public/pages/login.html`

Use the same Live Server address and port when opening other pages. The dashboard is at `public/index.html`; secondary pages are inside `public/pages`. Do not open the files with `file://`, because Supabase authentication and browser storage require a web origin.

## Authentication

Pages that contain private user content include these scripts in this order:

```html
<script src="supabase-client.js"></script>
<script src="auth-guard.js"></script>
```

`auth-guard.js` checks for a valid Supabase session and redirects signed-out or expired users to `login.html`. Log in first before opening `profile.html` directly. The profile page is at `public/pages/profile.html`; this is the only profile page that should be kept.

Protected pages may start with the following style:

```html
<style>
	body {
		visibility: hidden;
	}
</style>
```

This prevents protected content from briefly appearing while authentication is checked. The auth guard reveals the page after a valid session is found. Keep this style only when `auth-guard.js` is included; otherwise the page will remain hidden. Define it once, preferably in the `<head>`.

## Supabase Configuration

The public Supabase URL and publishable key are configured in `supabase-client.js`. The publishable key is intended for frontend use, but database Row Level Security policies must still protect user data.

## Course Materials

The authenticated materials page is `public/pages/materials.html`. It uses the private `materials` Supabase Storage bucket and the `materials` database table. Run `database/migrations/001-schema-additions.sql` followed by `database/migrations/002-materials-profile.sql` in the Supabase SQL Editor, then create a private Storage bucket named `materials` before uploading files.

The development-only helper `database/dev/reset-test-signup.sql` is destructive and should be run manually in Supabase SQL Editor only. It is not part of the deployment migration sequence.
