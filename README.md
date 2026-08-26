# LegalHub

LegalHub is a browser-based legal resources application using Supabase for authentication and user data.

## Run Locally

1. Open the `legalhub` folder in VS Code.
2. Start the project with the VS Code Live Server extension.
3. Open `login.html` through the Live Server URL, for example:

	 `http://127.0.0.1:5500/login.html`

Use the same Live Server address and port when opening other pages. Do not open the files with `file://`, because Supabase authentication and browser storage require a web origin.

## Authentication

Pages that contain private user content include these scripts in this order:

```html
<script src="supabase-client.js"></script>
<script src="auth-guard.js"></script>
```

`auth-guard.js` checks for a valid Supabase session and redirects signed-out or expired users to `login.html`. Log in first before opening `profile.html` directly.

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
