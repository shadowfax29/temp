# Ticketing — phase 1 and phase 2 (slice A)

Internal helpdesk for TapMind employees, replacing UVdesk. Design: `taskly-ticketing-flow.html` (the full flow, all four phases).
This is **phase 1 only**: the foundation. Routing rules, automatic assignment, handoffs between teams/categories, SLA, automation, email and reports are later phases.

## What works now

| Area | Behaviour |
|---|---|
| Raise | Any employee: the **New ticket** button on the Tickets page (a canvas, no separate page) → category → sub-category → that sub-category's form (text, long text, number, choose-one, date; required or not) |
| Key | `<prefix>-<number>` per category (e.g. `ADO-1001`) |
| Routing | The ticket goes to the category's **default team** (unassigned). No default team → it waits in **Triage**; the category owner or an admin picks the team |
| Assignment | By hand. Team lead (or above) assigns anyone in the team; a **Senior** agent can take from the team list and hand their own ticket to a teammate |
| Conversation | Public replies (requester sees) and internal notes (agents only) |
| Statuses | Open → In progress ⇄ Pending / On hold → Resolved → Closed; Spam. See "Rules" |
| Audit | Every change writes a hash-chained event and rolls the ownership period (team + assignee + status), in the same transaction. The ticket's History tab shows both and whether the chain is intact |
| Access | Four modules in Access Management, switched on by hand (by default only the Admin and Super Admin user types have them): `tkt_new` (the New ticket button),  `tkt_my` (raise / own tickets), `tkt_inbox` (agents), `tkt_settings` (admins). Seeing and acting on a ticket also depends on team membership |
| Switch User | Events record the real admin as well (`impersonated_by`) |

## Roles on a ticket

| Who | Can |
|---|---|
| Requester | See own ticket and public replies, reply, reopen a Resolved ticket within 7 days |
| Agent – Basic | Work tickets **assigned to them**: reply, note, priority, status |
| Agent – Senior | Also: take unassigned tickets of their team, hand over their own, work any ticket of the team |
| Team lead | Also: assign anyone in the team, close Resolved tickets |
| Category owner | Lead rights on the category's tickets, and choose the team for Triage tickets |
| Admin (`tkt_settings`) | Everything, and the settings screens |

## Status rules (the same flow as UVdesk)

Six statuses: **Open, Pending, Answered, Resolved, Closed, Spam**.

- A new ticket is **Open**.
- A **public reply from the team makes it Answered** ("Reply and set Pending" makes it Pending instead). Internal notes never change the status.
- The **customer's reply makes it Open again** (from Answered or Pending; or reopens a Resolved ticket within 7 days).
- An agent can set any open status from the Status dropdown on the ticket; **Resolved needs a resolution note**, which is posted to the customer. **Closed** is for team leads. Spam is one click. An admin can bring a Closed or Spam ticket back to Open.
- Ticket list views (left sidebar): All tickets, New (no reply from the team yet), Unassigned, Unanswered (Open: the customer wrote last), My tickets, Triage, then by status: Pending, Answered, Resolved, Closed, Spam.
- Wording follows UVdesk: a category is a **Group**, a sub-category is a **Ticket type**; people raising tickets are **Customers** (employees only).

## Where things are

- Migration `src/config/migrations/025_ticketing_foundation.sql` (undo: `down/025_…`). Tables `tkt_*`.
- Backend `src/modules/ticketing/`: `ticketing.service.ts` (the one place that changes tickets), `ticketing.settings.service.ts`, `ticketing.routes.ts` (`/t2.0/authentificationUtilization/ticketing/…`).
- Frontend `src/pages/ticketing/` and `src/components/ticketing/`; routes `/ticketing/new|my|inbox|t/:key|settings`; sidebar group "Ticketing".
- Check: `npx tsx src/scripts/ticketingCheck.ts` (in `nodejs-backend`) runs the whole lifecycle on temporary data and deletes it.
- Demo data (optional): `npx tsx src/scripts/ticketingSeed.ts`.

## Decisions taken for phase 1

- Web form only; **no email in or out** (the backend has no inbound mail and SMTP is not configured).
- The existing HR **Queries** module (HR Experience → Support) is left as it is. Moving it into ticketing as a category is a later decision.
- Team members are managed in Ticketing → Settings, not read from leave/attendance (there is no leave data source yet), so "on leave" skipping comes with the automatic assignment methods in phase 2.
- Insert-only event log is enforced by the single write path plus the hash chain (`verifyChain`). Database triggers need `SUPER` or `log_bin_trust_function_creators`, so they are optional: `docs/ticketing-triggers.sql`.
- No notifications yet (phase 2). People find tickets in the inbox / My Tickets.

## Phase 2, slice A: routing and handoffs (migration 026)

| Area | Behaviour |
|---|---|
| Routing rules | Per category, tried top to bottom, first match wins. A rule is "all of these conditions → team"; a condition looks at a form field, the sub-category, the requester's department, or the priority (is / is not). No match → the sub-category's default team → the category's default team → Triage. Edited under Settings → category → Routing rules, with a **Test routing** box (changes nothing) |
| Assignment methods | Set per team: **Manual** (lead assigns), **Round-robin**, **Least open tickets**, **Skill match** (members' skills vs the sub-category's skill, then least open), **Self-pick** (any member takes it). Members who are **Away**, at the team's open-ticket limit, or inactive are skipped. If nobody is available it waits in the team list and the event says why |
| Away | Agents switch themselves Away in the Inbox; it applies in every team they belong to |
| Reassign | As in phase 1 (lead assigns anyone; a Senior hands over their own) |
| Team transfer | Senior agent or above; same category; reason required. Lands in the new team's list and its method runs. The old owner stays a **watcher**; the requester is told |
| Re-categorize | Team lead or category owner; reason required; the new category's routing rules run; missing required fields of the new form must be given. The ticket keeps its key |
| Watchers | See the public conversation of the ticket, cannot work it |
| Audit | Routing and assignment decisions are logged as rule events (with the rule id); transfers and re-categorizing log the reason; the chain now covers the rule id too |

## Teams come from the department structure (migration 028)

A team is normally a **sub department** from Department Management: members = its active people, lead = its Functional Leader (else Executive Leader). Ticketing keeps only its own overrides (privilege, skills, "not in ticketing", a hand-picked lead, people added by hand). See `docs/ticketing-guide.md` for the full user guide.

## Not yet (phase 2 slice B and later)

Escalation timers (unassigned 15 / 60 min, not opened 30 min) and notifications (in-app, push, email out) · inbound email · boards, workload view, sub-tasks, merge · automation rules and SLA clocks · reports, time log, CSAT · UVdesk import.
