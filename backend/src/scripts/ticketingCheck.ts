// End-to-end check of ticketing phase 1 on a temporary category and team (all deleted at the end): npx tsx src/scripts/ticketingCheck.ts
// Makes its own temporary users (e2e-*@test.local) with their own roles: ADMIN, LEAD leads the team, SENIOR / BASIC are agents, REQ raises, OTHER is outside the team. All removed at the end.
import type mysql from 'mysql2/promise';
import { pool } from '../config/db';
import * as svc from '../modules/ticketing/ticketing.service';
import * as cfg from '../modules/ticketing/ticketing.settings.service';
import { candidates } from '../modules/ticketing/ticketing.routing';
import fs from 'fs';
import { createPerson, deletePeopleByEmail, hashPassword } from '../modules/access/people.service';
import { UPLOAD_DIR, pathOf, type SavedFile } from '../modules/ticketing/ticketing.files';

type Row = mysql.RowDataPacket;
let ADMIN = 0, LEAD = 0, SENIOR = 0, BASIC = 0, REQ = 0, OTHER = 0;
const actor = (userId: number, impersonatedBy: number | null = null): svc.Actor => ({ userId, impersonatedBy, ip: '127.0.0.1' });
let failures = 0;
const ok = (cond: unknown, what: string) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}`); if (!cond) failures++; };
const throws = async (fn: () => Promise<unknown>, what: string) => { try { await fn(); ok(false, what); } catch (e) { ok(true, `${what} (${(e as Error).message})`); } };
const q = async (sql: string, p: unknown[] = []) => (await pool.query<Row[]>(sql, p))[0];

async function makeUsers() {
  const role = async (_type: string | null, name: string, _privs: string | null) => {
    const [r] = await pool.query<Row[]>('SELECT RoleID FROM AMRole WHERE RoleName = ?', [name]);
    return (r[0]?.['RoleID'] as number) ?? 0;
  };
  const admin = await role('SUPER_ADMIN', 'Admin', null), agent = await role(null, 'Agent', null), requester = await role(null, 'Requester', null), lead = await role(null, 'Team Lead', null);
  const hash = await hashPassword('e2e-password-1');
  const add = (n: string, roleId: number) => createPerson({ name: `E2E ${n}`, email: `e2e-${n.toLowerCase()}@test.local`, roleId, passwordHash: hash });
  ADMIN = await add('Admin', admin); LEAD = await add('Lead', lead); SENIOR = await add('Senior', agent); BASIC = await add('Basic', agent); REQ = await add('Requester', requester); OTHER = await add('Other', agent);
}

let catId = 0, triageCatId = 0, teamId = 0, subId = 0;

async function cleanup() {
  const cats = await q(`SELECT id FROM tkt_category WHERE prefix IN ('TSTA','TSTB','TSTC','TSTD')`);
  const ids = cats.map((c) => c['id'] as number);
  if (ids.length) {
    const tickets = await q('SELECT id FROM tkt_ticket WHERE category_id IN (?)', [ids]);
    const tids = tickets.map((t) => t['id'] as number);
    if (tids.length) {
      const [att] = await pool.query<Row[]>('SELECT stored_name FROM tkt_attachment WHERE ticket_id IN (?)', [tids]);
      for (const a of att) fs.rmSync(pathOf(a['stored_name']), { force: true });
    }
    if (tids.length) for (const t of ['tkt_attachment', 'tkt_period', 'tkt_event', 'tkt_message', 'tkt_watcher']) await pool.query(`DELETE FROM ${t} WHERE ticket_id IN (?)`, [tids]);
    await pool.query('DELETE FROM tkt_ticket WHERE category_id IN (?)', [ids]);
    await pool.query('DELETE FROM tkt_route_rule WHERE category_id IN (?)', [ids]);
    await pool.query('DELETE FROM tkt_field WHERE subcategory_id IN (SELECT id FROM tkt_subcategory WHERE category_id IN (?))', [ids]);
    await pool.query('DELETE FROM tkt_subcategory WHERE category_id IN (?)', [ids]);
    await pool.query('DELETE FROM tkt_category_team WHERE category_id IN (?)', [ids]);
    await pool.query('DELETE FROM tkt_category WHERE id IN (?)', [ids]);
  }
  const teams = await q(`SELECT id FROM tkt_team WHERE name IN ('E2E Ticketing Team', 'E2E Ticketing Team B', 'E2E Ticketing Dept')`);
  for (const t of teams) {
    await pool.query('DELETE FROM tkt_category_team WHERE team_id = ?', [t['id']]);
    await pool.query('DELETE FROM tkt_team_member WHERE team_id = ?', [t['id']]);
    await pool.query('DELETE FROM tkt_team WHERE id = ?', [t['id']]);
  }
  await deletePeopleByEmail('e2e-%@test.local');
}

async function main() {
  await cleanup();
  await makeUsers();

  // ── setup by the admin: team, category with a form, a category without a default team (Triage)
  teamId = (await cfg.saveTeam({ name: 'E2E Ticketing Team', leadUserId: LEAD, maxOpen: 5 })).id;
  await cfg.setMembers(teamId, [{ userId: SENIOR, privilege: 'SENIOR' }, { userId: BASIC, privilege: 'BASIC' }]);
  catId = (await cfg.saveCategory({ name: 'E2E Ad Ops', prefix: 'tsta', ownerUserId: LEAD, defaultTeamId: teamId, teamIds: [teamId] })).id;
  subId = (await cfg.saveSubcategory(catId, { name: 'Tag Request' })).id;
  await cfg.setFields(subId, [
    { key: 'format', label: 'Ad format', type: 'SELECT', required: true, options: ['Video', 'Display'] },
    { key: 'units', label: 'Units', type: 'NUMBER' },
  ]);
  triageCatId = (await cfg.saveCategory({ name: 'E2E No Default', prefix: 'TSTB', ownerUserId: LEAD, teamIds: [teamId] })).id;
  const triageSub = (await cfg.saveSubcategory(triageCatId, { name: 'Anything' })).id;

  const teams = await cfg.listTeams();
  const team = teams.find((t) => t.id === teamId)!;
  ok(team.members.find((m) => m.userId === LEAD)?.privilege === 'LEAD', 'the team lead is added as a member with the Team Lead privilege');
  ok((await cfg.listCategories()).find((c) => c.id === catId)?.prefix === 'TSTA', 'the key prefix is stored upper case');
  await throws(() => cfg.saveCategory({ name: 'Dup', prefix: 'TSTA' }), 'a second category cannot reuse a key prefix');

  // ── raising
  await throws(() => svc.createTicket({ categoryId: catId, subcategoryId: subId, subject: 'x', description: 'y', fields: { format: 'Native' } }, actor(REQ)), 'a select field only takes its options');
  const { key } = await svc.createTicket({ categoryId: catId, subcategoryId: subId, subject: 'Tag request for the test site', description: 'Please set up the tag.', priority: 'HIGH', fields: { format: 'Video', units: '5' } }, actor(REQ));
  ok(/^TSTA-\d+$/.test(key), `the key comes from the category prefix (${key})`);
  let t = await svc.getTicket(key, REQ);
  ok(t.status === 'OPEN' && t.team?.id === teamId && t.assignee === null, 'a new ticket is Open, in the category default team, not assigned');
  ok(t.fields.find((f) => f.key === 'units')?.value === 5, 'form values are kept (number as a number)');
  ok(t.messages.length === 1 && t.permissions.canReply && !t.permissions.canNote, 'the requester has the first message and can reply but not add notes');

  // ── who sees what
  await throws(() => svc.getTicket(key, OTHER), 'someone with no part in the ticket cannot open it');
  t = await svc.getTicket(key, SENIOR);
  ok(t.permissions.canTake && !t.permissions.canAssign, 'a Senior agent can take it but not assign others');
  t = await svc.getTicket(key, BASIC);
  ok(!t.permissions.canTake && !t.permissions.canReply, 'a Basic agent cannot take, and cannot reply on a ticket that is not theirs');
  t = await svc.getTicket(key, LEAD);
  ok(t.permissions.canAssign && t.teamMembers.length === 3, 'the team lead can assign, and sees the members with their load');
  const inbox = await svc.listInbox(SENIOR, 'unassigned', {});
  ok(inbox.tickets.some((x) => x.key === key), 'the unassigned ticket is in the team queue of a team member');
  await throws(() => svc.listInbox(OTHER, 'all', {}), 'a person who is on no team has no inbox');

  // ── working the ticket
  await svc.take(key, actor(SENIOR));
  t = await svc.getTicket(key, SENIOR, actor(SENIOR));
  ok(t.assignee?.id === SENIOR, 'a Senior agent takes it from the list');
  const kNew = (await svc.getTicket(key, SENIOR)).status;
  ok(kNew === 'OPEN' && (await svc.listInbox(SENIOR, 'new', {})).tickets.some((x) => x.key === key), 'before any reply the ticket is Open and under New');
  await svc.reply(key, actor(SENIOR), 'Thanks, checking the tag now.');
  await svc.addNote(key, actor(SENIOR), 'Internal: check the staging ad unit first.');
  ok((await svc.getTicket(key, SENIOR)).status === 'OPEN', 'a public reply or an internal note never changes the status');
  t = await svc.getTicket(key, REQ);
  ok(t.status === 'OPEN' && t.firstResponseAt != null, 'the first public reply from the team is the first response, and the status stays as it was');
  await svc.changeStatus(key, actor(SENIOR), 'ANSWERED');
  ok(!(await svc.listInbox(SENIOR, 'unanswered', {})).tickets.some((x) => x.key === key) && (await svc.listInbox(SENIOR, 'answered', {})).tickets.some((x) => x.key === key),
    'an Answered ticket is under Answered, not Unanswered');
  ok(!t.messages.some((m) => m.kind === 'NOTE'), 'the requester never sees internal notes');
  ok((await svc.getTicket(key, SENIOR)).messages.some((m) => m.kind === 'NOTE'), 'agents see them');
  // files on a reply and on a note
  const stash = (name: string): SavedFile => { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); const stored = `e2e${Date.now()}${Math.random().toString(16).slice(2, 8)}.txt`; fs.writeFileSync(pathOf(stored), 'hello'); return { originalName: name, storedName: stored, mime: 'text/plain', size: 5 }; };
  await svc.addNote(key, actor(SENIOR), 'see the secret file', [stash('secret.txt')]);
  await svc.reply(key, actor(SENIOR), 'here is the answer', [stash('answer.txt')]);
  const agentView = await svc.getTicket(key, SENIOR);
  const noteFile = agentView.messages.find((m) => m.kind === 'NOTE' && m.attachments.length)?.attachments[0];
  const replyFile = agentView.messages.find((m) => m.kind === 'REPLY' && m.attachments.length)?.attachments[0];
  ok(noteFile?.name === 'secret.txt' && replyFile?.name === 'answer.txt', 'files are kept on the reply and on the note they were sent with');
  const reqView = await svc.getTicket(key, REQ);
  ok(reqView.messages.every((m) => m.kind !== 'NOTE') && reqView.messages.some((m) => m.attachments.some((a) => a.name === 'answer.txt')), 'the requester sees the reply file, not the note');
  ok(!!(await svc.attachmentLink(key, String(replyFile!.id), REQ)).url, 'the requester gets a link to the reply file');
  await throws(() => svc.attachmentLink(key, String(noteFile!.id), REQ), 'the requester cannot get a link to a file on an internal note');
  await throws(() => svc.attachmentLink(key, String(replyFile!.id), OTHER), 'a stranger cannot get a link');
  const via = await svc.attachmentByLink((await svc.attachmentLink(key, String(replyFile!.id), SENIOR)).url.split('/').pop()!);
  ok(fs.existsSync(via.path) && via.name === 'answer.txt', 'a link resolves to the stored file');
  await throws(() => svc.attachmentByLink('not-a-token'), 'a bad link is refused');
  ok((await svc.listMine(REQ, {})).tickets.find((x) => x.key === key)?.requesterEmail != null, 'the list carries the email of whoever raised the ticket');
  await throws(() => svc.reply(key, actor(BASIC), 'hi'), 'an agent who is not the assignee (and not Senior) cannot reply');
  await svc.assign(key, actor(SENIOR), BASIC);
  ok((await svc.getTicket(key, BASIC)).assignee?.id === BASIC, 'a Senior agent hands their own ticket to a teammate');
  await throws(() => svc.assign(key, actor(BASIC), SENIOR), 'a Basic agent cannot assign');
  await svc.assign(key, actor(LEAD), SENIOR);
  await svc.assign(key, actor(LEAD), BASIC);
  t = await svc.getTicket(key, BASIC);
  ok(t.assignee?.id === BASIC && t.status === 'ANSWERED', 'the team lead reassigns; the status stays');
  await throws(() => svc.assign(key, actor(LEAD), OTHER), 'assigning to someone outside the team is refused');

  await svc.reply(key, actor(BASIC), 'Can you share the ad unit ID?');
  ok((await svc.getTicket(key, REQ)).status === 'ANSWERED', 'a team reply leaves the status alone');
  await svc.changeStatus(key, actor(BASIC), 'PENDING');
  await svc.reply(key, actor(REQ), 'It is /2178/home_top');
  ok((await svc.getTicket(key, REQ)).status === 'PENDING', 'a requester reply does not reopen the ticket by itself');
  await svc.changeStatus(key, actor(BASIC), 'OPEN');
  await svc.reply(key, actor(BASIC), 'Thanks, working on it.');
  await svc.changeStatus(key, actor(BASIC), 'ANSWERED');
  ok((await svc.getTicket(key, REQ)).status === 'ANSWERED', 'the status is whatever the agent set by hand');
  await svc.reply(key, actor(REQ), 'One more thing.');
  ok((await svc.getTicket(key, REQ)).status === 'ANSWERED', 'a requester reply to an Answered ticket leaves the status alone');
  ok((await svc.getTicket(key, BASIC)).permissions.transitions.map((x) => x.to).sort().join() === 'OPEN,PENDING,RESOLVED,SPAM', 'an agent can set any open status (Closed is for team leads)');

  await throws(() => svc.changeStatus(key, actor(BASIC), 'RESOLVED'), 'Resolved needs a resolution note');
  await throws(() => svc.changeStatus(key, actor(BASIC), 'CLOSED', 'x'), 'an agent cannot close a ticket (that is for team leads)');
  await svc.changeStatus(key, actor(BASIC), 'RESOLVED', 'Live on staging and prod.');
  t = await svc.getTicket(key, REQ);
  ok(t.status === 'RESOLVED' && t.permissions.canReopen && t.messages.at(-1)?.body === 'Live on staging and prod.', 'resolving posts the note to the requester and allows a reopen');
  await svc.reopen(key, actor(REQ), 'Still broken on mobile');
  ok((await svc.getTicket(key, REQ)).status === 'OPEN', 'the requester reopens a Resolved ticket within 7 days');
  await svc.changeStatus(key, actor(BASIC), 'RESOLVED', 'Fixed for mobile too.');
  await throws(() => svc.changeStatus(key, actor(BASIC), 'CLOSED', 'x'), 'only a team lead closes (a Basic agent is refused)');
  await svc.changeStatus(key, actor(LEAD), 'CLOSED');
  t = await svc.getTicket(key, REQ);
  ok(t.status === 'CLOSED' && t.permissions.canReply === false, 'a Closed ticket takes no more replies');
  await throws(() => svc.reply(key, actor(REQ), 'one more'), 'replying to a Closed ticket is refused');

  // ── the audit trail
  const h = await svc.history(key, LEAD);
  const tm = (await svc.getTicket(key, LEAD)).timer;
  ok(tm.laps.length >= 3 && tm.totalSecs === tm.laps.reduce((n, l) => n + l.secs, 0) && !tm.running, `the timer has a lap for each update and its total is their sum (${tm.laps.length} laps, ${tm.totalSecs}s, stopped)`);
  ok(tm.laps.every((l) => !l.running) && new Set(tm.laps.map((l) => l.owner)).size >= 2, 'laps record who owned the ticket (more than one person on this ticket)');
  ok((await svc.getTicket(key, REQ)).timer.laps.length === 0, 'the requester sees the total only, not the laps');
  ok(h.chain.ok && h.chain.events === h.events.length && h.events.length >= 12, `the event chain verifies (${h.events.length} events)`);
  ok(h.periods.length >= 6 && h.periods.every((p) => p.to !== null), `every ownership period is closed after Closed (${h.periods.length} periods)`);
  ok(h.periods.some((p) => p.assignee === 'E2E Senior') && h.periods.some((p) => p.assignee === 'E2E Basic') && h.periods.some((p) => p.status === 'PENDING'),
    'periods show who held it, and the Pending time');
  ok(h.events.some((e) => e.kind === 'RULE'), 'a change made by a rule (requester reply on Pending) is logged as a rule event');
  await throws(() => svc.history(key, REQ), 'the requester cannot read the history');
  const ev = await q('SELECT id FROM tkt_event WHERE ticket_id = (SELECT id FROM tkt_ticket WHERE ticket_key = ?) ORDER BY id LIMIT 1 OFFSET 3', [key]);
  await pool.query('UPDATE tkt_event SET details = ? WHERE id = ?', ['tampered', ev[0]!['id']]);
  const broken = await svc.history(key, LEAD);
  ok(!broken.chain.ok && broken.chain.brokenAt === Number(ev[0]!['id']), `editing one event breaks the chain at that event (#${ev[0]!['id']})`);

  // ── Triage and routing; Switch User is recorded
  const k2 = (await svc.createTicket({ categoryId: triageCatId, subcategoryId: triageSub, subject: 'No team yet', description: 'Where does this go?' }, actor(REQ, ADMIN))).key;
  const t2 = await svc.getTicket(k2, LEAD);
  ok(t2.team === null && t2.permissions.canRoute, 'a category without a default team leaves the ticket in Triage for the category owner');
  ok((await svc.listInbox(LEAD, 'triage', {})).tickets.some((x) => x.key === k2), 'it shows in the owner\'s Triage view');
  await throws(() => svc.route(k2, actor(SENIOR), teamId), 'only the category owner or an admin can pick the team');
  await svc.route(k2, actor(LEAD), teamId);
  const t3 = await svc.getTicket(k2, SENIOR);
  ok(t3.team?.id === teamId, 'the owner routes it to a team');


  // ══ phase 2: routing rules, assignment methods, handoffs ═════════════════════════════════════
  const teamB = (await cfg.saveTeam({ name: 'E2E Ticketing Team B', leadUserId: OTHER, maxOpen: 50, assignmentMethod: 'ROUND_ROBIN', categoryIds: [catId] })).id;
  await cfg.setMembers(teamB, [{ userId: BASIC, privilege: 'BASIC' }, { userId: SENIOR, privilege: 'SENIOR', skills: ['VPN'] }]);
  await cfg.setRules(catId, [{ name: 'Ad format is Display', conditions: [{ type: 'field', key: 'format', op: 'is', value: 'Display' }], teamId: teamB }]);
  await throws(() => cfg.setRules(catId, [{ name: 'Empty', conditions: [], teamId: teamB }]), 'a rule needs at least one condition');
  await throws(() => cfg.setRules(catId, [{ name: 'Bad team', conditions: [{ type: 'priority', op: 'is', value: 'HIGH' }], teamId: 999999 }]), 'a rule\'s team must serve the category');
  await cfg.setRules(catId, [{ name: 'Ad format is Display', conditions: [{ type: 'field', key: 'format', op: 'is', value: 'Display' }], teamId: teamB }]);
  const mk = (format: string, priority: svc.Priority = 'MEDIUM', by = REQ) =>
    svc.createTicket({ categoryId: catId, subcategoryId: subId, subject: `Routing ${format}`, description: 'x', priority, fields: { format } }, actor(by)).then((r) => r.key);

  const kVideo = await mk('Video');
  ok((await svc.getTicket(kVideo, LEAD)).team?.id === teamId, 'no rule matches Video: the category default team');
  const byId = [BASIC, SENIOR, OTHER].sort((a, b) => a - b);
  const preview = await cfg.testRouting(catId, { subcategoryId: subId, fields: { format: 'Display' } });
  ok(preview.route.teamId === teamB && preview.route.ruleId != null && preview.pick?.userId === byId[0], 'Test routing shows the rule\'s team and who would get it');
  ok((await q('SELECT COUNT(*) n FROM tkt_ticket WHERE subject = ?', ['Routing Display']))[0]!['n'] == 0, 'Test routing changes nothing');

  // round-robin on team B (members by id: BASIC 119, SENIOR 121, lead 147)
  const rr: number[] = [];
  for (let i = 0; i < 4; i++) rr.push((await svc.getTicket(await mk('Display'), LEAD)).assignee!.id);
  ok(JSON.stringify(rr) === JSON.stringify([byId[0], byId[1], byId[2], byId[0]]), `round-robin goes round the members (${rr.join(', ')})`);
  const hist = await svc.history(await mk('Display'), LEAD);
  ok(hist.events.some((e) => e.type === 'route' && e.kind === 'RULE') && hist.events.some((e) => e.type === 'assign' && e.kind === 'RULE' && /Round-robin/.test(e.details ?? '')),
    'the rule and the round-robin pick are both logged as rule events');

  await cfg.saveTeam({ name: 'E2E Ticketing Team B', leadUserId: OTHER, maxOpen: 50, assignmentMethod: 'LEAST_OPEN', categoryIds: [catId] }, teamB);
  const before = (await candidates(pool, teamB)).list;
  const least = [...before].sort((a, b) => a.open - b.open || a.userId - b.userId)[0]!;
  ok((await svc.getTicket(await mk('Display'), LEAD)).assignee?.id === least.userId, `least open tickets picks the lightest load (${least.name}, ${least.open})`);

  await cfg.saveSubcategory(catId, { name: 'Tag Request', skill: 'vpn' }, subId);
  await cfg.saveTeam({ name: 'E2E Ticketing Team B', leadUserId: OTHER, maxOpen: 50, assignmentMethod: 'SKILL', categoryIds: [catId] }, teamB);
  ok((await svc.getTicket(await mk('Display'), LEAD)).assignee?.id === SENIOR, 'skill match gives it to the member with the skill, whatever the load');
  await cfg.saveSubcategory(catId, { name: 'Tag Request', skill: null }, subId);

  await cfg.saveTeam({ name: 'E2E Ticketing Team B', leadUserId: OTHER, maxOpen: 1, assignmentMethod: 'LEAST_OPEN', categoryIds: [catId] }, teamB);
  const full = await svc.getTicket(await mk('Display'), LEAD);
  ok(full.assignee === null && (await svc.history(full.key, LEAD)).events.some((e) => /Nobody available/.test(e.details ?? '')), 'when everyone is at the limit it waits in the team list and says why');

  await cfg.saveTeam({ name: 'E2E Ticketing Team B', leadUserId: OTHER, maxOpen: 50, assignmentMethod: 'SELF_PICK', categoryIds: [catId] }, teamB);
  const sp = await svc.getTicket(await mk('Display'), BASIC);
  ok(sp.assignee === null && sp.permissions.canTake, 'self-pick: stays in the list and even a Basic member can take it');
  await svc.take(sp.key, actor(BASIC));
  ok((await svc.getTicket(sp.key, BASIC)).assignee?.id === BASIC, 'the Basic member takes it');

  // handoffs
  await cfg.saveTeam({ name: 'E2E Ticketing Team B', leadUserId: OTHER, maxOpen: 50, assignmentMethod: 'MANUAL', categoryIds: [catId] }, teamB);
  const kh = await mk('Display');
  await svc.assign(kh, actor(OTHER), BASIC);
  await throws(() => svc.transfer(kh, actor(BASIC), teamId, 'wrong team'), 'a Basic agent cannot transfer a ticket');
  await throws(() => svc.transfer(kh, actor(OTHER), teamId, ' '), 'a team transfer needs a reason');
  await throws(() => svc.transfer(kh, actor(OTHER), teamB, 'same team'), 'transferring to the team it is already with is refused');
  await svc.transfer(kh, actor(OTHER), teamId, 'Display creative, not video');
  const moved = await svc.getTicket(kh, LEAD);
  ok(moved.team?.id === teamId && moved.assignee === null && moved.watchers.some((w) => w.userId === BASIC), 'a team transfer lands in the new team unassigned, and the old owner becomes a watcher');
  const asRequester = await svc.getTicket(kh, REQ);
  ok(asRequester.messages.some((m) => m.kind === 'SYSTEM' && /moved to E2E Ticketing Team/.test(m.body)), 'the requester is told the team changed');
  const asWatcher = await svc.getTicket(kh, BASIC);
  ok(!asWatcher.permissions.canReply && !asWatcher.messages.some((m) => m.kind === 'NOTE'), 'a watcher can read the ticket but not work it or see notes');
  const th = await svc.history(kh, LEAD);
  ok(th.events.some((e) => e.type === 'transfer' && /Display creative/.test(e.details ?? '')) && th.chain.ok, 'the transfer is in the audit trail with its reason, and the chain holds');

  await throws(() => svc.recategorize(kh, actor(SENIOR), { categoryId: triageCatId, subcategoryId: triageSub, reason: 'wrong kind' }), 'only a team lead or category owner can re-categorize');
  await throws(() => svc.recategorize(kh, actor(LEAD), { categoryId: triageCatId, subcategoryId: triageSub, reason: '' }), 're-categorizing needs a reason');
  await svc.recategorize(kh, actor(LEAD), { categoryId: triageCatId, subcategoryId: triageSub, reason: 'This is not an ad ops request' });
  const rc = await svc.getTicket(kh, LEAD);
  ok(rc.category.id === triageCatId && rc.key === kh && rc.team === null, 're-categorized: new category, same key, and the new category\'s routing runs (here: Triage)');
  await throws(() => svc.recategorize(kh, actor(LEAD), { categoryId: catId, subcategoryId: subId, reason: 'back again' }), 'moving into a form with required fields asks for them');
  await svc.recategorize(kh, actor(LEAD), { categoryId: catId, subcategoryId: subId, fields: { format: 'Video' }, reason: 'back again' });
  ok((await svc.getTicket(kh, LEAD)).team?.id === teamId, 'with the required field given it routes by the category\'s rules again');
  ok((await svc.history(kh, LEAD)).chain.ok, 'the chain still verifies after the handoffs');

  // ══ raising a ticket by choosing the group, the team and (optionally) the person ═════════════
  const gD = (await cfg.saveCategory({ name: 'E2E Plain Group', prefix: 'TSTD', ownerUserId: LEAD, teamIds: [teamId] })).id;
  const subsD = (await cfg.listCategories()).find((c) => c.id === gD)!.subcategories;
  ok(subsD.length === 1 && subsD[0]!.name === 'General', 'a new group comes with a General ticket type, so tickets can be raised without choosing one');
  const cat = await svc.catalog(ADMIN);
  ok(cat.types.some((x) => x.categoryId === gD && x.name === 'General') && cat.departments.some((d) => d.id === teamId), 'the form offers the ticket types and the active teams');

  // deleting a ticket type and a team
  const spare = (await cfg.saveSubcategory(gD, { name: 'E2E Spare Type' })).id;
  await cfg.deleteSubcategory(spare);
  ok(!(await cfg.listCategories()).find((c) => c.id === gD)!.subcategories.some((x) => x.id === spare), 'an unused ticket type can be deleted');
  await throws(() => cfg.deleteSubcategory(subId), 'a ticket type that tickets use cannot be deleted');
  const spareTeam = (await cfg.saveTeam({ name: 'E2E Spare Team', maxOpen: 5, active: true, categoryIds: [], assignmentMethod: 'MANUAL' })).id;
  await cfg.deleteTeam(spareTeam);
  ok(!(await cfg.listTeams()).some((x) => x.id === spareTeam), 'a team that never handled a ticket can be deleted');
  await throws(() => cfg.deleteTeam(teamId), 'a team that has handled tickets cannot be deleted');

  const rep = await svc.report(ADMIN, {});
  ok(rep.totals.raised >= 1 && rep.byStatus.reduce((n, x) => n + x.total, 0) === rep.totals.raised && rep.perDay.length > 0, 'the report adds up: every ticket is in exactly one status');
  ok(rep.byTeam.reduce((n, x) => n + x.total, 0) === rep.totals.raised && rep.byType.reduce((n, x) => n + x.total, 0) === rep.totals.raised, 'the report adds up per team and per ticket type');
  await throws(() => svc.report(REQ, {}), 'someone who is not on a team cannot open the report');
  const none = await svc.report(ADMIN, { status: 'SPAM', priority: 'URGENT', unassigned: true, q: 'no such ticket' });
  ok(none.totals.raised === 0 && none.agents.length > 0 && none.types.length > 0, 'the report filters narrow the tickets and still list the filter choices');
  const pick = (await svc.createTicket({ categoryId: gD, subject: 'Chosen team and person', description: 'x', teamId, assigneeId: SENIOR }, actor(REQ))).key;
  const tp = await svc.getTicket(pick, SENIOR);
  ok(tp.team?.id === teamId && tp.assignee?.id === SENIOR && tp.subcategory.name === 'General', 'a ticket raised with a team and a person goes to them, with no ticket type');
  const hp = await svc.history(pick, LEAD);
  ok(hp.events.some((e) => e.type === 'route' && /chosen by the requester/i.test(e.details ?? '')) && hp.events.some((e) => e.type === 'assign' && /chosen by the requester/i.test(e.details ?? '')), 'both choices are logged as made by the requester');

  const onlyTeam = await svc.getTicket((await svc.createTicket({ categoryId: gD, subject: 'Chosen team only', description: 'x', teamId }, actor(REQ))).key, LEAD);
  ok(onlyTeam.team?.id === teamId && onlyTeam.assignee === null, 'with only a team, the method of that team decides the person (manual: it waits for the lead)');
  const nothing = await svc.getTicket((await svc.createTicket({ categoryId: gD, subject: 'Nothing chosen', description: 'x' }, actor(REQ))).key, LEAD);
  ok(nothing.team === null, 'with no team chosen and no default, it waits in Triage as before');

  await throws(() => svc.createTicket({ categoryId: gD, subject: 'x', description: 'y', teamId: 999999 }, actor(REQ)), 'a team that does not exist cannot be chosen');
  await throws(() => svc.createTicket({ categoryId: gD, subject: 'x', description: 'y', teamId, assigneeId: REQ }, actor(REQ)), 'a person who is not in the chosen team cannot be chosen');
  await throws(() => svc.createTicket({ categoryId: gD, subject: 'x', description: 'y', assigneeId: SENIOR }, actor(REQ)), 'a person cannot be chosen without a team');

  // ── prefix is frozen once there are tickets
  await throws(() => cfg.saveCategory({ name: 'E2E Ad Ops', prefix: 'ZZZ' }, catId), 'a category with tickets cannot change its key prefix');
}

main()
  .catch((e) => { console.error(e); failures++; })
  .finally(async () => {
    await cleanup();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed; temporary data removed.');
    await pool.end();
    process.exit(failures ? 1 : 0);
  });
