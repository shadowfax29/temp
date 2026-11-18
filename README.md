# Ticketing Tool

A standalone ticketing tool, separate from Taskly: its own users, roles, teams, ticket categories, tickets and (next) timer.

```
ticketing-tool/
  backend/   Express + TypeScript + MySQL (own database "ticketdesk")
  frontend/  React + Vite app (port 3040)
  docs/      guide and phase notes carried over from Taskly
```

## One-time database setup

Run this in MySQL Workbench as a user that may create databases (root). Pick your own password.

```sql
CREATE DATABASE ticketdesk CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'ticketdesk'@'localhost' IDENTIFIED BY 'CHOOSE-A-PASSWORD';
GRANT ALL PRIVILEGES ON ticketdesk.* TO 'ticketdesk'@'localhost';
FLUSH PRIVILEGES;
```

## Backend

```
cd backend
copy .env.example .env      # fill DB_PASSWORD, JWT_SECRET (32+ chars), SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD
npm install
npm run db:migrate          # creates users, roles and the ticketing tables, and the four starting roles
npm run db:seed             # creates the first admin
npm run check               # end-to-end check on temporary data (removed afterwards)
npm run dev                 # http://localhost:8090
```

## Frontend

```
cd frontend
npm install
npm run dev                 # http://localhost:3040  (forwards /api to the backend on 8090)
```

Sign in with the admin from `db:seed`. Without a mail server the 6-digit code is shown on the sign-in screen in development; for real mail set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` in `backend/.env`.

API (all under `/api`): `POST /auth/login`, `GET /auth/me`, `GET /auth/catalog` (the permission list),
`/admin/roles`, `/admin/users`, and `/ticketing/...` (catalog, tickets, reply, note, status, assign, handoff, settings, report, files).

## What changed from the Taskly module

- Own sign-in (email and password, JWT) and own `Users` / `AMRole` tables (names kept so the ticket queries stayed the same).
- Roles are edited in the tool: tick View / Create / Edit / Delete per permission. The Admin role always has everything.
- Teams are made by hand (lead, members, how tickets are given out). No departments.
- Any active team can handle any ticket type. Only people with Tickets: Edit can name the assignee; for everyone else the team decides.

## What is in it

- **Sign-in in two steps**: password, then a 6-digit code (boxes like Taskly). Per person: follow the default, always, or never. Five wrong attempts lock the email for 15 minutes.
- **Login logs** (Administration): every attempt with person, result, address and browser; filters and paging.
- **Roles, Users, Teams, Ticket categories**: all created inside the tool. Teams and Ticket categories are separate menu items with their own permissions.
- **Tickets**: raise with files and video, reply, notes, status (always by hand), reports with CSV.
- **Assign** and **Hand off** open as checkboxes; hand off can go to another team, another person in the team, or a different ticket type.
- **Timer**: starts when the ticket is assigned, shown as six digits (HH MM SS) with every lap underneath. A reply, note, status change, reassignment or hand off ends a lap. It pauses on Pending and stops on Resolved or Closed.
- **New users**: the admin enters name, email, role and teams; no password. A 12-character temporary password is generated and emailed. At the first sign-in the person is sent to a Choose your password page and nothing else opens until they do (8+ characters, letters and a number). An admin can send a new temporary password to anyone from the Users page. Passwords are stored hashed; changes are in the login log.
- **Mail**: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` in `backend/.env`. In development with no mail server the temporary password and the sign-in code are shown on screen instead; in production creating a user is refused until mail works.

