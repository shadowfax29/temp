# Taskly Ticketing: user guide

For the people who set up ticketing (admins), the teams who handle tickets (agents, team leads, group owners) and everyone who raises one.
Ticketing is the internal helpdesk that replaces UVdesk. It works the same way: a ticket is **Open**, gets **Answered**, goes **Pending**, is **Resolved**, then **Closed**.

---

## 1. The idea in one minute

1. An employee **raises a ticket**: they choose the **ticket type** (e.g. VPN access), the **department** that should handle it and, if they know who, a **person** of that department. Then they write a subject and description and can attach **files or videos**.
2. The team is a **sub department** you already have in Department Management (e.g. "IT Operations"). Its people are the team, its leader is the team lead.
3. If the customer named a person, the ticket goes to them. Otherwise Taskly picks an **agent** by the team's method, or leaves it in the team's list for the lead to assign.
4. The agent **replies**. Replies never change the status: the agent sets it by hand (for example **Answered** or **Pending**), and the customer's reply does not reopen it by itself.
5. The agent **resolves** it with a note. The customer can reopen it for 7 days. A team lead then **closes** it.

Everything that happens to a ticket (who did what, who held it and for how long) is recorded automatically and cannot be edited.

**Teams come from your departments.** Ticketing only *reads* Department Management. Adding a team to ticketing never changes a department, a sub department, anyone's role or anyone's reporting line.

---

## 2. Words used

| Word | Meaning |
|---|---|
| **Customer** | The employee who raised the ticket |
| **Group** | A kind of request, such as *IT Support* or *Ad Ops Requests*. Has an owner, one or more teams and a default team |
| **Team** | A sub department that handles tickets (or, rarely, a custom team built by hand) |
| **Agent** | A member of a team |
| **Team lead** | The sub department's Functional Leader (else its Executive Leader), unless an admin picks someone else |
| **Group owner** | The person responsible for a group; chooses the team for tickets that have none |
| **Triage** | Where a ticket waits when no team could be chosen for it |
| **Watcher** | Someone who follows a ticket, for example the previous owner after a handoff |

---

## 3. Setting up (admins)

Open **Ticketing → Settings**. The first tab, **Setup guide**, shows what is done and what still needs doing, and links to each step. Do the steps in this order.

### Step 1: Add teams from your departments

*Why: tickets must go to people. Using the departments you already have means nobody is typed in twice and the team stays correct when people join or leave.*

1. Settings → **Teams** → **Add team from a department**.
2. Choose the **sub department** that will handle tickets from the list (grouped under its department; there is a search box). A department that has no sub departments appears as "(whole department)".
   *You only see the sub departments that are yours:* ones where you are the **Executive Leader** or **Functional Leader**, or where **people report to you**. Admin and Super Admin see all of them. Adding a team for any other sub department is refused.
3. Check the preview: how many people become members, and who the lead will be.
4. Give the team a name (it is filled in for you) and click **Add team**.

What you get: its active people are members (privilege *Basic*), its Functional Leader (else Executive Leader) is the **team lead**.
From then on the team follows the sub department: a new joiner is added, someone who leaves is removed. **Update from department** on the team does this right away; it also happens by itself when people open their tickets.

Then adjust the team (**Edit** and **Members**):

| Setting | What it does | Advice |
|---|---|---|
| **How tickets are assigned** | Manual, Round-robin, Least open tickets, Skill match, Self-pick (see section 7) | Start with *Manual*. Move to *Round-robin* or *Least open* once the team is happy |
| **Most open tickets per agent** | Automatic assignment skips someone who already holds this many | 8 is a sensible start |
| **Members → In ticketing** | Switch a person off to keep them out of ticketing although they are in the sub department | Use for people who should not receive tickets (e.g. on long leave) |
| **Members → Privilege** | Basic, Senior, Team lead, Supervisor (section 6) | Make experienced people *Senior* so they can take and transfer tickets |
| **Members → Skills** | Words such as *VPN*, used only by teams that assign by skill | |
| **Add someone from another department** | A person who is not in the sub department but should handle these tickets | Marked "Added by hand"; the sync never removes them |
| **Team lead** | Normally the department's leader. You can pick someone else | "Use the department's leader again" goes back |

*Custom team* (rare): for people from several departments who handle tickets together. You add every member by hand. Prefer a department team wherever you can.

### Step 2: Add groups (what people can ask for)

There are **no groups to set up** any more. Settings → **Ticket types** → **New ticket type**: name it (for example *Tag request*) and optionally give it a skill. A type has no extra form questions. A ticket type is everything the customer chooses from, apart from the department. (Behind the scenes tickets still belong to one hidden group that supplies the ticket number prefix, such as `ADS-1001`; nobody sees or manages it.) Routing rules stay switched off.

### Step 3: Try it

Open **Tickets → New ticket**, choose the ticket type, then the department (its people fill the Assignee list), optionally a person, add a file if you like, and raise a test ticket. The form shows your own email (read-only); it is also shown to the team on the ticket and in the Customer column. The **Setup guide** tab tells you when steps 1 and 2 are complete.

### Giving people access (Access Management)

Ticketing is **off for everyone except Admin and Super Admin** until you switch it on. Open **Admin → Access Management** and tick the **Ticketing** group, for a **role**, a **department**, or **one person** (Users → Access panel). Nobody needs a separate sign-up.

| Permission | What it opens | Typical use |
|---|---|---|
| **Ticketing** (the group) | Shows the Ticketing menu | Tick for anyone who gets one of the rows below |
| **New Ticket** (Create) | The **New ticket** button on the Tickets page | Everyone who may raise tickets |
| **Raised by me** | Open a ticket you raised (the **Raised by me** list on the Tickets page), reply, reopen | Everyone who may raise tickets |
| **Tickets** | The ticket list of the teams you belong to | Agents, team leads, group owners |
| **Ticketing Settings** | Settings: teams and groups | Admins only |

To let a whole role raise tickets: tick **Ticketing**, **New Ticket** (View + Create) and **Raised by me** (View + Create + Edit) for that role. For agents also tick **Tickets** (View + Edit). *Being on a team still decides which tickets an agent sees*: the permission only opens the page.
People must **sign in again** after their access changes.

### Setup checklist

- [ ] Every team has a lead, at least one member, and handles at least one group
- [ ] Every group has an owner, at least one team and a default team
- [ ] You raised one real test ticket

The **Setup guide** tab shows these automatically under *Things to fix*.

---

## 4. Raising a ticket (anyone with the New Ticket permission)

1. **Ticketing → Tickets → New ticket**. A side canvas opens over the page; there is no separate page. Everyone has this page; people who are not on a ticketing team see only the button and a short notice.
2. Choose the **group**. Its default team is already selected; change it if another team of the group should handle it.
3. Choose the **assignee** if you know who should take it, or leave **Let the team decide**. Then write a clear **subject** and **description** and pick a **priority**, and **Raise ticket**.
4. Follow it under **Tickets → Raised by me**. Reply there when the team asks you something. When it is **Resolved**, read the note: if it is not fixed, press **Reopen** (within 7 days), or just reply.

Only people with a Taskly login can raise tickets. There is no outside customer portal and no email-in yet.

---

## 5. Working tickets (agents)

**Ticketing → Tickets** shows the ticket list. The left sidebar has the views, with counts:

| View | Shows |
|---|---|
| **All tickets** | Everything in your teams and groups (not Spam) |
| **New** | Open tickets nobody on the team has replied to yet |
| **Unassigned** | In a team's list with nobody holding them |
| **Unanswered** | Open tickets waiting for the team (the customer wrote last) |
| **Assigned to me** | Assigned to you and not resolved |
| **Raised by me** | The tickets you raised yourself (the only list people who are not on a team see) |
| **Triage** | No team yet (group owners and admins) |
| **Pending / Answered / Resolved / Closed / Spam** | By status |

On a ticket:

- **Reply** to the customer, or add an **Internal note** (only the team sees notes). A reply never changes the status; set it yourself with the Status dropdown.
- **Status** dropdown: Open, Pending, Answered, Resolved (needs a **resolution note**, which the customer reads), Spam. Only a team lead closes.
- **Priority**: change it from the side panel.
- **Take this ticket**: from a team list, if your privilege allows it (Senior and above, or anyone on a *Self-pick* team).

### Status flow

| Status | How a ticket gets there |
|---|---|
| **Open** | Raised; or the customer replied; or reopened |
| **Answered** | Set by the agent when the team has replied |
| **Pending** | The team replied and said it waits for the customer |
| **Resolved** | An agent resolved it with a note |
| **Closed** | A team lead closed it. Read-only |
| **Spam** | An agent marked it |

### Handing a ticket on

| Action | Who | Needs |
|---|---|---|
| **Reassign** to another member of the team | Team lead; a Senior agent for their own ticket | |
| **To another team** (same group) | Senior agent or above | A reason. The new team's method runs; you stay as a watcher; the customer is told |
| **To another group** | Team lead or group owner | A reason, and the new form's required fields. The new group's rules run. The ticket keeps its key |
| **Choose the team** for a Triage ticket | Group owner or admin | |

---

## 6. Privileges in a team

| | Basic | Senior | Team lead |
|---|---|---|---|
| Reply, note, status, priority on tickets **assigned to them** | ✓ | ✓ | ✓ |
| Work on any ticket of the team | | ✓ | ✓ |
| Take a ticket from the team list | (only if the team is *Self-pick*) | ✓ | ✓ |
| Hand over their own ticket to a teammate | | ✓ | ✓ |
| Transfer to another team | | ✓ | ✓ |
| Assign anyone in the team | | | ✓ |
| Move to another group, close tickets | | | ✓ |

Admins can do everything, and also see every ticket. Group owners have team-lead rights on their group's tickets.

---

## 7. How a person is picked (assignment methods)

Set on each team. All of them skip members at the team's **open-ticket limit**, or no longer active.

| Method | Picks | Good for |
|---|---|---|
| **Manual** | Nobody: it waits in the team list and the lead assigns | Sensitive work, small volumes |
| **Round-robin** | The next available person after the last one assigned | Similar work, an even spread |
| **Least open tickets** | The available person with the fewest open tickets | Work of very different size |
| **Skill match** | Someone with the right skill, then the fewest open (skills are set on members; with no ticket type to ask for one it behaves like *Least open tickets*) | Specialists |
| **Self-pick** | Nobody: any member takes it from the list | Small teams |

If nobody can be picked, the ticket waits in the team list; the ticket's History says why.

---

## 8. History and audit

Agents open a ticket's **History** tab to see every event (who created it, which rule routed it, who was assigned, every reply and status change, handoff reasons) and **who held it, in which team and status, from when to when**. A banner says whether the log is intact: each event is chained to the one before it, so any edit is detected. If someone used *Switch User*, the real admin is shown next to the action.

---

## 9. Questions

**I cannot see Ticketing, or part of it.** Ticketing is switched on by hand in Access Management. By default only the Admin and Super Admin user types have it (see "Giving people access" above). Ask an admin to tick the permissions you need, then sign in again.

**A menu item is missing after an update.** Sign out and in again: the menu is built from your permissions at sign-in.

**A ticket is stuck in Triage.** Its group has no default team and no rule matched. The group owner opens it and chooses the team. To stop it happening, set a default team on the group.

**A new joiner is not in the team.** Check they are in the sub department (Department Management) and active. Press **Update from department** on the team. Make sure they are not switched off under **Members**.

**Nobody gets assigned automatically.** The team's method may be Manual or Self-pick; or everyone is at the open-ticket limit. The ticket's History says which.

**Someone's leader changed.** The team lead follows the sub department's leader, unless an admin picked a lead by hand (then choose **Use the department's leader again**).

**Can a team be deleted?** Not yet. Switch it **Inactive**: it stops receiving tickets and its history stays.

---

## 10. Not available yet

Automatic reminders when a ticket waits too long, notifications (in-app, push, email), email in and out, SLA timers, boards and reports, tags, labels, stars, trash, merge, collaborators (CC), saved replies and prepared responses, workflows, and the UVdesk import. The ticket list and the audit trail already work without them.

## Files and videos

- Add up to **5 files, 100 MB each**, when raising a ticket, replying or writing an internal note. A file on an internal note is for agents only.
- Allowed: pictures (png, jpg, gif, webp, bmp), video (mp4, mov, webm, mkv, avi, m4v), audio (mp3, wav, m4a, ogg), pdf, Word/Excel/PowerPoint/OpenDocument, txt, csv, log, zip. Anything else is refused.
- Pictures, videos and audio play on the ticket page; other files open or download in a new tab. A link to a file works for ten minutes and only for someone who may see the ticket.
- Files are stored on the server's disk in `nodejs-backend/uploads/tickets` (set `TICKET_UPLOAD_DIR` to move it) under random names, and are not in git. **Back this folder up with the database.** Behind a reverse proxy raise its upload limit (for nginx, `client_max_body_size 110m;`).

## Custom teams

Custom (hand-built) teams are no longer offered: teams are always departments or sub departments from Department Management, and only those appear on the New ticket form. A custom team made earlier still works for tickets it already has, but is marked *Old custom team* and is not offered on the form.

## Deleting

Ticket types and teams have a **Delete** button in Settings. A ticket type that any ticket uses cannot be deleted, and neither can a team that has handled a ticket, because their history names them. Switch the type off (hidden from the form) or make the team Inactive instead. Deleting a team never touches the people or the department behind it.

## Who can raise a ticket to which department

- **Admin and Super Admin**: any department that is a ticketing team.
- **An Executive or Functional Leader, or someone people report to**: the departments they lead or manage.
- **Everyone else** raises for themselves: the Department is fixed to their own department (they only choose the ticket type; there is no Assignee, the department decides who takes it). Leaders and admins must choose a person of the department as the assignee, and may choose themselves. Their department must be added as a team in Settings first.

## Report

**Ticketing → Report** is one consolidated summary for a period (the last 30 days to begin with; change From / To, or pick a team): tickets raised, open now, resolved or closed and the percentage, spam, average first reply and average time to resolve, tickets per day, and breakdowns by status, priority, team, ticket type, agent and who raised them, plus the ten oldest open tickets. **Download CSV** saves the numbers. It shows the tickets the person can see on the Tickets page (admins: all); it needs its own permission, **Ticketing → Ticket Report** (View) in Access Management. Admin and Super Admin have it; grant it to anyone else (a role, a department or a person), who must also be on a ticketing team to see numbers.

