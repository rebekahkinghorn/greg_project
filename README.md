# 403_project
Project for 403 business programming. This is a small website that connects to the same Supabase project as our 401 project does. It has an admin login so the admin can access the users in the 401 project and maintain them.
## Greg Project admin site

Live site: [https://403project.vercel.app/](https://403project.vercel.app/)

Greg Project is the Express and EJS admin companion for Cougar AI and the IS 403 project. It runs on Vercel and connects to the same Supabase project as Cougar AI.

### Admin features

- Sign in with a Supabase administrator account.
- **Maintain Users** to list, create, update, and delete accounts in Supabase Authentication.
- **Maintain Records** to create, view, edit, and delete rows in public.greg_table. The editable fields are name and description; Supabase supplies id and created_at.
- Log out to clear the session cookie and hide the protected admin controls.
- Use the **Cougar AI main site** links to return to the main site. On mobile, the maintenance pages show a hamburger menu and stack table rows into labeled cards.

### Authentication and data access

Greg Project shares the Supabase project and administrator account with Cougar AI, but it has its own login session. Sign in again when opening Greg Project, even if already signed in to Cougar AI. Protected pages and API routes verify administrator access on the server. Supabase Auth user management uses a server-side secret key that must never be sent to the browser.

### Deployment configuration

Set these environment variables in the Vercel project settings:

- SUPABASE_URL
- SUPABASE_PUBLISHABLE_KEY
- SUPABASE_SECRET_KEY

Keep SUPABASE_SECRET_KEY private and out of GitHub. For local development, put the values in the ignored .env file and start the server with npm start.
