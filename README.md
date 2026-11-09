# Ritel POS

Retail point-of-sale and inventory management built as a separate React + TypeScript + Vite application. Netlify hosts the frontend and TypeScript Functions; Supabase provides authentication and persistent PostgreSQL data. This project does not use or deploy the Laravel reference application.

## What is included

- Indonesian responsive workspace for administrators, cashiers, and warehouse staff.
- Sign-in only (there is no public sign-up), role-checked API functions, product catalog, stock receipts/corrections, checkout, printable receipts, and admin reports.
- PostgreSQL migrations with row-level security and transactional RPCs for checkout and stock adjustments.
- Server-side account provisioning; the Supabase service-role key is never used in browser code.

## Prerequisites

- Node.js 20.19+ and npm.
- A Supabase project.
- A Netlify account and a Git repository for this project.
- Supabase CLI for migrations and database tests.

## 1. Install and configure

From this project folder:

```powershell
npm install
Copy-Item .env.example .env
```

In the Supabase project dashboard, copy the project URL, the publishable/anon key, and the service-role key. Edit `.env`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
```

The two `VITE_` values are intentionally public and are used by Supabase Auth in the browser. `SUPABASE_SERVICE_ROLE_KEY` is a secret: do not prefix it with `VITE_`, commit it, paste it into frontend code, or expose it in browser requests. `.env` is ignored by Git.

## 2. Create the database

Install the Supabase CLI if needed, then link the project and apply the versioned migrations:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

The migration creates profiles/roles, products, sales, sale items, inventory history, row-level security policies, and server-only transactional functions. Keep future schema changes in new files under `supabase/migrations/`; do not edit an already-applied migration.

Optional: run database integration tests locally. Docker Desktop must be running:

```powershell
npx supabase start
npm run test:db
npx supabase stop
```

## 3. Provision the first administrator

Use a trusted computer and terminal. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env` (or your shell environment); never share the service key. Then run:

```powershell
npm run provision-user -- --email admin@toko.id --name "Admin Toko" --role admin
```

The script asks for the password without echoing it. Use a unique password with at least 12 characters. It creates a confirmed Supabase Auth user and the matching `admin` profile. There is no public self-registration. After the first admin is created, use the same trusted script to provision accounts with `--role kasir` or `--role gudang`; a non-admin account cannot be created until an admin exists.

## 4. Run locally

Use Netlify's local development server so the frontend and Functions are available together:

```powershell
npx netlify-cli dev
```

Open the local URL printed by Netlify. Sign in with the provisioned account. `npm run dev` runs only Vite; it does not serve the Netlify Functions needed for the authenticated workflows.

## 5. Deploy to Netlify

1. Push this new project folder to its own Git repository. Do not connect or deploy the Laravel repository.
2. In Netlify, choose **Add new site → Import an existing project** and connect the new repository.
3. Use these build settings (also defined in `netlify.toml`):
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
4. In **Site configuration → Environment variables**, add:
   - `VITE_SUPABASE_URL` — Supabase project URL (available during the frontend build).
   - `VITE_SUPABASE_ANON_KEY` — Supabase publishable/anon key (available during the frontend build).
   - `SUPABASE_URL` — Supabase project URL (server-side Functions).
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase service-role secret (server-side Functions only).
5. Redeploy after setting or changing environment variables. Netlify's `/api/*` rewrites route requests to Functions before the final SPA fallback, so refreshing app pages still serves the React app without replacing API responses.
6. Create the initial admin using the provisioning command from a trusted terminal. Production database changes are applied with `npx supabase db push` against the linked Supabase project; never use function memory or local files for production data.

## Security notes

- Functions validate the Supabase access token and load the role from `profiles` on every protected request. A role value from the browser is never used for authorization.
- The service-role key is only read in `netlify/functions` and the trusted provisioning script. RPC execution is restricted to that server role; database constraints and row locks make each stock movement and checkout atomic.
- RLS protects direct database access by authenticated clients. Browser code uses Supabase Auth but sends protected data operations through the role-checked Functions.
- Supabase database backups and retention are managed by the hosted Supabase project; no production state is stored in Netlify Function memory or local files.

## Checks

```powershell
npm test
npm run typecheck
npm run build
```

The unit tests cover authentication/role decisions, checkout input validation, and report calculations. The SQL integration tests verify access to transactional functions, stock rollback on rejected checkout, stock decrements, cash change, and stored profit inputs.
