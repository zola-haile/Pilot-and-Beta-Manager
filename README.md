# Pilot Program Manager

A tool for product managers to run **pilot & beta programs**: create pilots, define
questions/fields for participants, invite users by email or link, and collect their
responses. Split into a standalone **backend** (REST API) and **frontend** (SPA).

```
backend/   Express + TypeScript + Prisma  → PostgreSQL   (JWT auth)
frontend/  React + Vite + TypeScript
```

## Hierarchy & roles

```
PM
 ├─ Application  (a product being piloted — a PM owns many)
 │    ├─ Feature (a taggable part of the app; PM-managed)
 │    ├─ Theme   (a cross-pilot insight the PM groups comments under)
 │    └─ Pilot
 │         ├─ Question (typed fields)
 │         ├─ PilotCompany (a company added to this pilot; carries a share link)
 │         ├─ Submission → Answer (a participant's dated entry; many over time)
 │         └─ Comment  (flexible feedback: body + category + features + images)
 │              └─ triage: status · priority · assignee · notes · duplicate-of · theme
 └─ Company  (top-level, reusable across pilots in ANY of the PM's apps)
      └─ Participant (a person at that company)
            └─ Membership (that person invited into a pilot)
```

Participants can also leave **flexible comments** on a pilot: free-text reason, a
**category** (enhancement / bug / feature request / should-be-removed / usability /
performance / praise / question / other), tagged **features** (from the app's feature
list), and **image attachments**. The PM manages the feature list per application and
sees all comments on each pilot.

**Triage** — the PM turns comments into work. Each comment carries a workflow
**status** (New → Triaged → Planned → In progress → Done / Won't do / Duplicate), a
**priority** (low/medium/high/critical), a free-text **assignee**, and a private
**notes** thread (never shown to participants). Comments can be **merged** as a duplicate
of a canonical one (which then shows "N duplicates"), or folded into an app-level
**Theme** — a recurring insight that gathers related feedback across every pilot in the
app.

**Feedback workspace** — the same surface works per-pilot and per-application
(`/applications/:appId/feedback`, aggregating every pilot). It offers an **Inbox** table
and a drag-to-move **Kanban board** by status; **filters** by keyword, type, feature,
company, status, priority, pilot, date range, and has-images; and **bulk actions** to set
status/priority/assignee, add to a theme, or merge many comments at once.

**Analytics dashboard** — per-pilot and per-application (`…/analytics`), with no external
chart libraries (inline SVG/CSS). It shows sentiment (derived from category), a type
breakdown, a **feedback-over-time** trend (volume + sentiment), a **feature × type
heatmap**, leaderboards (top requests / most-reported bugs / most praised), a **by-company**
table with participation rates and tone, and **structured-answer rollups**: per rating
question an average + distribution + over-time trend + an NPS-style score, plus yes/no
splits and multiple-choice tallies. The app view rolls ratings up across all pilots.

Applications and Companies are **siblings** under the PM: a company (with its admin and
people) can be added to pilots across several applications.

Three roles:
- **PM** — owns one or more applications; inside an application creates pilots, questions,
  and companies; adds companies to pilots (which emails that company's admin); can also invite
  individuals directly.
- **Company Admin** — set per company (by email). When their company is added to a pilot they
  get an email to set up an account, then invite their own people (by email **or** a shareable
  self-enroll link) and optionally enrol themselves, toggling between admin and piloting views.
- **Participant** — fills in the pilot's questions; can submit repeatedly over time.

## What's built

**PM (Product Manager) side**
- Register / sign in (email + password, JWT). Each PM gets a single **Application** (the
  product being piloted), which they can name/describe.
- Dashboard listing all pilots under the application with a computed status:
  `draft` / `upcoming` / `active` / `past` (derived from start & end dates).
- Create and delete pilots.
- Define typed questions/fields per pilot: short text, long text, number, yes/no,
  multiple choice, and 1–5 rating — each optionally required.
- **Companies** directory: partner orgs that take part across pilots. Drill into a company
  to see its people and which pilots each is in (app-wide), with entry counts.
- Invite participants by email into a pilot, assigning each to a company (existing or new).
  Each gets a unique invite link; emails are logged to the server console by default
  (no SMTP setup needed) and can be copied/resent.
- View all submitted responses per pilot (with the submitter's company); participants can
  submit repeatedly, each kept as its own dated entry.

**Participant side**
- Accept an invite via link, set a password, and land in their account.
- See the pilots they belong to and the questions the PM defined.
- Fill in the form, save a draft, or submit (required fields enforced on submit).

## Running it locally

### 1. Database
Uses PostgreSQL. Either use the local one this project was set up against
(`postgresql://zola@localhost:5432/pilots`) or start the bundled container:

```bash
docker compose up -d          # Postgres on host port 5433
# then set DATABASE_URL in backend/.env to the 5433 connection string
```

### 2. Backend
```bash
cd backend
npm install
cp .env.example .env          # already present; adjust DATABASE_URL if needed
npx prisma db push            # create tables
npm run dev                   # http://localhost:4000
```

### 3. Frontend
```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

The database is seeded with demo data:
- PM — **pm@test.com / password123** (two apps: "CheckoutApp" with CP Inc./Acme/Globex and two pilots, and "MobileApp")
- Company admin — **admin@cp.com / adminpass123** (CP Inc., already set up; Acme's admin is pending)
- Participant — **uma@cp.com / userpass123**

Open http://localhost:5173, register a new PM account, or use the seeded login above.
When you invite a participant, the invite email (with the link) is printed in the
**backend terminal** — open that link in a private window to go through the
participant flow.

## API surface (backend)

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/register` | public | Create a PM account |
| POST | `/auth/login` | public | Sign in |
| GET | `/auth/me` | auth | Current user |
| GET | `/auth/invitations/:token` | public | Preview an invite |
| POST | `/auth/invitations/:token/accept` | public | Accept invite, set password |
| GET/POST | `/applications` | PM | List / create applications |
| GET/PATCH/DELETE | `/applications/:appId` | PM | Get / rename / delete an application |
| GET/POST | `/applications/:appId/pilots` | PM | List / create pilots in an application |
| GET/POST | `/applications/:appId/features` | PM | List / add app features |
| PATCH/DELETE | `/features/:id` | PM | Edit / delete a feature |
| GET/POST | `/applications/:appId/themes` | PM | List / add feedback themes |
| PATCH/DELETE | `/themes/:id` | PM | Rename / delete a theme |
| GET/PATCH/DELETE | `/pilots/:id/comments[/:cid]` | PM | View / triage / delete pilot comments |
| POST/DELETE | `/pilots/:id/comments/:cid/notes[/:nid]` | PM | Add / delete a private triage note |
| GET | `/applications/:appId/comments` | PM | All comments across the app's pilots (Feedback view) |
| PATCH | `/applications/:appId/comments/bulk` | PM | Bulk triage: set status/priority/assignee/theme, or merge |
| GET | `/pilots/:id/analytics` | PM | Analytics for one pilot (+ structured-answer rollups) |
| GET | `/applications/:appId/analytics` | PM | Analytics across the app (+ ratings roll-up) |
| POST/GET/DELETE | `/my/pilots/:id/comments[/:cid]` | participant | Add / list own / delete comment |
| GET/POST | `/companies` | PM | List / add companies (top-level; admin email required) |
| GET/PATCH/DELETE | `/companies/:id` | PM | Company drill-down (across apps) / edit / delete |
| POST | `/companies/:id/invite-admin` | PM | Email the company admin their setup link |
| POST/DELETE | `/pilots/:id/companies[/:pcId]` | PM | Add / remove a company in a pilot (emails admin) |
| GET/POST | `/auth/admin-invitations/:token[/accept]` | public | Company-admin setup |
| GET | `/admin/participations` | Admin | Pilots the admin's companies are in |
| GET | `/admin/participations/:pcId` | Admin | Manage that company's people in the pilot |
| POST/DELETE | `/admin/participations/:pcId/participants[/:mid]` | Admin | Invite / remove people |
| POST | `/admin/participations/:pcId/self-enroll` | Admin | Admin joins as a participant |
| GET/POST | `/join/:token[/accept]` | public | Self-enroll via a company share link |
| GET/POST | `/pilots` | PM | List / create pilots |
| GET/PATCH/DELETE | `/pilots/:id` | PM | Detail / update / delete |
| POST/PATCH/DELETE | `/pilots/:id/questions[/:qid]` | PM | Manage questions |
| POST/DELETE | `/pilots/:id/invitations[/:mid]` | PM | Invite / revoke participants |
| POST | `/pilots/:id/invitations/:mid/resend` | PM | Resend an invite |
| GET | `/pilots/:id/responses` | PM | All submitted responses |
| GET | `/my/pilots` | participant | Pilots I'm in |
| GET | `/my/pilots/:id` | participant | Questions + my answers |
| PUT | `/my/pilots/:id/submission` | participant | Save draft / submit |
```
