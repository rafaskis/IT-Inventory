# GitHub Pages trial deployment

This project is prepared for GitHub Free + GitHub Pages + the existing hosted Supabase project.

## Important visibility note

GitHub Free requires a public repository for GitHub Pages. The source code and frontend bundle will therefore be publicly accessible. The application login page will also be publicly reachable. Supabase authentication, database grants, Row Level Security and Edge Function authorization must protect all company data and operations.

Do not commit company data, real employee/inventory exports, passwords, service-role keys, database passwords, Supabase access tokens, or `.env.local`.

## 1. Prepare the repository

Create a **public** GitHub repository named `IT-Inventory` (or use your existing repository with its actual name). The Vite configuration derives the Pages base path from the GitHub repository name, so no username needs to be hardcoded.

Before the first push, check that the repository contains no:
- `.env.local` or other actual environment files
- `supabase/.temp/` or `supabase/.branches/`
- `.git/`, `node_modules/`, or `dist/`
- real company data or exported database contents

If this project folder is not already connected to the intended GitHub repository, from the project root:

```powershell
git init
git add .
git status
```

Review the staged file list carefully. Confirm no environment files, credentials, local runtime files, or private data are staged. Then:

```powershell
git commit -m "Prepare IT-Inventory GitHub Pages trial"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/IT-Inventory.git
git push -u origin main
```

If a Git repository/remote already exists, do not run `git init` or add a second remote. Check `git remote -v` and use the correct existing repository.

## 2. Add frontend build variables in GitHub

In the GitHub repository:
1. Open **Settings → Secrets and variables → Actions → Variables**.
2. Add these repository variables:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://liiskbdbtynfjcnqezbm.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The hosted project's `sb_publishable_...` key |

These two values are intended to be included in the browser application. They are not service credentials. Never add the Supabase secret key or service-role key as a `VITE_` variable.

## 3. Enable GitHub Pages

In the repository:
1. Open **Settings → Pages**.
2. Under **Build and deployment → Source**, select **GitHub Actions**.

The included workflow `.github/workflows/deploy.yml` runs on pushes to `main` and can also be started manually from **Actions**. It installs dependencies, runs lint, builds the frontend, and deploys `dist` to GitHub Pages.

The workflow fails early if either frontend variable is missing.

## 4. Record the final Pages URL

For a repository named `IT-Inventory`, the URL will be:

`https://YOUR_GITHUB_USERNAME.github.io/IT-Inventory/`

The origin (used for CORS) is only:

`https://YOUR_GITHUB_USERNAME.github.io`

Do not include `/IT-Inventory/` in the CORS origin.

## 5. Hosted Supabase configuration — do this after the Pages URL is known

Do not change hosted settings until the GitHub Pages URL is known and the first deployment has succeeded.

Then configure:

### Edge Function CORS

Set the hosted Edge Function secret `APP_ALLOWED_ORIGIN` to the exact origin:

`https://YOUR_GITHUB_USERNAME.github.io`

This must match the `Origin` header exactly. The current functions default to `http://localhost:5173` when this secret is absent, which is why this hosted setting is required for the deployed site.

### Supabase Auth URLs

In Supabase Dashboard → **Authentication → URL Configuration**:
- Set **Site URL** to the full Pages URL, including `/IT-Inventory/`.
- Add the full Pages URL to the redirect URL allow-list.
- Keep any required local development redirect URLs only if you still need hosted-backend testing from localhost.

### Deploy Edge Functions

The six functions in `supabase/functions/` must be deployed to the hosted project after reviewing their secrets and configuration:
- `manage-audit`
- `manage-catalogues`
- `manage-employees`
- `manage-inventory`
- `manage-locations`
- `manage-users`

Use the Supabase CLI with the linked project only after confirming the target project reference is `liiskbdbtynfjcnqezbm`. Do not deploy database migrations as part of frontend publishing.

## 6. Trial validation

Before inviting employees:
- Confirm the Pages site loads over HTTPS.
- Confirm login succeeds with the hosted administrator.
- Confirm sign-out and sign-in work.
- Confirm all pages load and Edge Function requests succeed.
- Confirm an unauthenticated visitor cannot access application data.
- Confirm viewer/inventory-manager restrictions and security audit visibility.
- Confirm no service-role key or other secret appears in browser source, build artifacts, Git history, or browser requests.
- Use only test data during the trial.

## 7. Local development remains local

Keep `.env.local` configured for local Supabase:

```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_LOCAL_SUPABASE_PUBLISHABLE_KEY
```

Do not change `supabase/config.toml` to point at the hosted project. It configures the local stack. GitHub Actions uses repository variables to build the hosted frontend.

To switch between local and hosted frontend testing, use the appropriate environment file and restart Vite after changing it.
