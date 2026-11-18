/**
 * /api/ticketing — the ticketing tool.
 *   everyone (tkt_my):      catalog, raise a ticket, my tickets, reply, reopen
 *   agents (tkt_inbox):     inbox, notes, status, assign, take, priority, route; what each person may do on a ticket is decided in ticketing.service
 *   admins (tkt_teams, tkt_categories): teams and members, ticket categories
 */
import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middlewares/auth';
import { requireModule } from '../../middlewares/permission';
import { validate } from '../../middlewares/validate';
import { sendSuccess } from '../../utils/response';
import { AppError } from '../../utils/AppError';
import { can } from '../access/access.service';
import * as svc from './ticketing.service';
import * as uv from './uvtickets.service';
import * as uvt from './uvteams.service';
import * as uvc from './uvcategories.service';
import * as uvw from './uvwrite.service';
import { INLINE, cleanName, discardOnError, uploadFiles, uploaded } from './ticketing.files';
import * as cfg from './ticketing.settings.service';

const router = Router();
// A file opens with a short-lived signed link (so <video> and <a> work without a header); it is checked here, not by the sign-in middleware
router.get('/files/:token', async (req, res, next) => {
  try {
    const token = String(req.params['token']);
    const f = uv.linkKind(token) === 'uv' ? await uv.attachmentByLink(token) : await svc.attachmentByLink(token);
    const inline = INLINE.has(f.kind) || f.mime === 'application/pdf';
    res.setHeader('Content-Type', f.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(cleanName(f.name))}`);
    res.sendFile(f.path, (err) => { if (err && !res.headersSent) next(AppError.notFound('This file is not on the server yet: the UVdesk attachments folder has not been copied over.')); });
  } catch (e) { next(e); }
});

router.use(authenticate);


const uid = (req: Request) => Number(req.user?.sub);

/** Allowed when the person holds at least one of the listed permissions */
const anyOf = (...checks: [string, 'read' | 'create' | 'update' | 'delete'][]) => (req: Request, _res: Response, next: NextFunction) => {
  Promise.all(checks.map(([m, a]) => can(uid(req), m, a)))
    .then((r) => (r.some(Boolean) ? next() : next(AppError.forbidden('You do not have access to this.'))))
    .catch(next);
};

/** Who is acting, for the history */
async function actorOf(req: Request): Promise<svc.Actor> {
  return { userId: uid(req), impersonatedBy: null, ip: req.ip ?? null };
}

const h = (fn: (req: Request) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req).then((data) => sendSuccess(res, data)).catch(next);
};

const id = z.coerce.number().int().positive();
const text = (max: number) => z.string().trim().min(1).max(max);

// ── For everyone ─────────────────────────────────────────────────────────────────────────────────
router.get('/me', h((req) => uv.me(uid(req))));
router.get('/catalog', anyOf(['tkt_new', 'create'], ['tkt_my', 'read']), h((req) => uv.catalog(uid(req))));

const NewTicket = z.object({
  categoryId: id.optional(), subject: text(200), description: text(10000), priority: z.enum(svc.PRIORITIES).optional(),
  teamId: id.optional(), assigneeId: id.optional(), subcategoryId: id.optional(),
  // a form with files is multipart, where the extra answers travel as one JSON string
  fields: z.preprocess((v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return undefined; } }, z.record(z.unknown()).optional()),
});
router.post('/tickets', requireModule('tkt_new', 'create'), uploadFiles, discardOnError, validate(NewTicket), h(async (req) => uvw.createTicket(req.body, await actorOf(req), uploaded(req))));

const ListQ = z.object({
  status: z.string().optional(), priority: z.string().optional(), q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).optional(), size: z.coerce.number().int().min(1).max(100).optional(),
  teamId: z.coerce.number().int().optional(), categoryId: z.coerce.number().int().optional(),
  view: z.enum(['all', 'new', 'unassigned', 'unanswered', 'assigned', 'triage', 'pending', 'answered', 'resolved', 'closed', 'spam']).optional(),
});
router.get('/report', requireModule('tkt_report', 'read'), validate(z.object({ from: z.string().optional(), to: z.string().optional(), teamId: z.coerce.number().int().optional(), status: z.string().optional(), priority: z.string().optional(), typeId: z.coerce.number().int().optional(), assigneeId: z.coerce.number().int().optional(), unassigned: z.enum(['1']).optional().transform((v) => v === '1'), q: z.string().max(100).optional() }), 'query'),
  h((req) => uv.report(uid(req), req.query as uv.ReportQuery)));
router.get('/tickets/mine', requireModule('tkt_my', 'read'), validate(ListQ, 'query'), h((req) => uv.listMine(uid(req), req.query as uv.ListQuery)));
router.get('/tickets/inbox', requireModule('tkt_inbox', 'read'), validate(ListQ, 'query'),
  h((req) => uv.listInbox(uid(req), (req.query['view'] as uv.InboxView | undefined) ?? 'assigned', req.query as uv.ListQuery)));

router.get('/tickets/:key', requireModule('tkt_my', 'read'), h(async (req) => uv.getTicket(String(req.params['key']), uid(req))));
router.get('/tickets/:key/history', requireModule('tkt_inbox', 'read'), h((req) => uv.history(String(req.params['key']), uid(req))));

// after any change the screens get the ticket back as this person now sees it
const then = async (req: Request) => uv.getTicket(String(req.params['key']), uid(req));

const Reply = z.object({ body: text(10000) });
router.post('/tickets/:key/reply', requireModule('tkt_my', 'update'), uploadFiles, discardOnError, validate(Reply),
  h(async (req) => { await uvw.reply(String(req.params['key']), await actorOf(req), req.body.body, uploaded(req)); return then(req); }));
router.get('/tickets/:key/attachments/:id/link', requireModule('tkt_my', 'read'), h((req) => uv.attachmentLink(String(req.params['key']), String(req.params['id']), uid(req))));
router.post('/tickets/:key/reopen', requireModule('tkt_my', 'update'), validate(z.object({ reason: z.string().max(2000).optional() })),
  h(async (req) => { await uvw.reopen(String(req.params['key']), await actorOf(req), req.body.reason); return then(req); }));

// ── For agents ───────────────────────────────────────────────────────────────────────────────────
const agent = requireModule('tkt_inbox', 'update');
router.post('/tickets/:key/note', agent, uploadFiles, discardOnError, validate(z.object({ body: text(10000) })),
  h(async (req) => { await uvw.addNote(String(req.params['key']), await actorOf(req), req.body.body, uploaded(req)); return then(req); }));
router.post('/tickets/:key/status', agent, validate(z.object({ status: z.enum(svc.STATUSES), text: z.string().max(5000).optional() })),
  h(async (req) => { await uvw.changeStatus(String(req.params['key']), await actorOf(req), req.body.status, req.body.text); return then(req); }));
router.post('/tickets/:key/priority', agent, validate(z.object({ priority: z.enum(svc.PRIORITIES) })),
  h(async (req) => { await uvw.setPriority(String(req.params['key']), await actorOf(req), req.body.priority); return then(req); }));
router.post('/tickets/:key/assign', agent, validate(z.object({ userId: id.nullable() })),
  h(async (req) => { await uvw.assign(String(req.params['key']), await actorOf(req), req.body.userId); return then(req); }));
router.post('/tickets/:key/take', agent,
  h(async (req) => { await uvw.take(String(req.params['key']), await actorOf(req)); return then(req); }));
router.post('/tickets/:key/transfer', agent, validate(z.object({ teamId: id, reason: text(500) })),
  h(async (req) => { await uvw.transfer(String(req.params['key']), await actorOf(req), req.body.teamId, req.body.reason); return then(req); }));
router.post('/tickets/:key/recategorize', agent,
  validate(z.object({ categoryId: z.coerce.number().int().optional(), subcategoryId: id, fields: z.record(z.unknown()).optional(), reason: text(500) })),
  h(async (req) => { await uvw.recategorize(String(req.params['key']), await actorOf(req), req.body); return then(req); }));
router.post('/tickets/:key/route', agent, validate(z.object({ teamId: id })),
  h(async (req) => { await uvw.route(String(req.params['key']), await actorOf(req), req.body.teamId); return then(req); }));

// ── For admins ───────────────────────────────────────────────────────────────────────────────────
// teams and categories are separate pages with their own permission
const readTeams = requireModule('tkt_teams', 'read');
const writeTeams = requireModule('tkt_teams', 'update');
const readCat = requireModule('tkt_categories', 'read');
const writeCat = requireModule('tkt_categories', 'update');

const Category = z.object({
  name: text(120), prefix: z.string().trim().min(2).max(8), description: z.string().max(500).nullish(), departmentId: z.coerce.number().int().nullish(),
  ownerUserId: z.coerce.number().int().nullish(), defaultTeamId: z.coerce.number().int().nullish(), active: z.boolean().optional(), teamIds: z.array(id).optional(),
});
router.get('/settings/categories', readCat, h(() => uvc.listCategories()));
router.post('/settings/categories', writeCat, validate(Category), h((req) => cfg.saveCategory(req.body)));
router.put('/settings/categories/:id', writeCat, validate(Category), h((req) => cfg.saveCategory(req.body, Number(req.params['id']))));

const Sub = z.object({
  name: text(120), active: z.boolean().optional(), sortOrder: z.coerce.number().int().optional(),
  defaultTeamId: z.coerce.number().int().nullish(), skill: z.string().max(60).nullish(),
});
router.post('/settings/categories/:cid/subcategories', writeCat, validate(Sub), h((req) => uvc.saveCategory(Number(req.params['cid']), req.body)));
router.put('/settings/categories/:cid/subcategories/:sid', writeCat, validate(Sub),
  h((req) => uvc.saveCategory(Number(req.params['cid']), req.body, Number(req.params['sid']))));

const Fields = z.object({
  fields: z.array(z.object({
    key: z.string().trim().min(1).max(40), label: text(120), type: z.enum(cfg.FIELD_TYPES), required: z.boolean().optional(), options: z.array(z.string().max(120)).optional(),
  })).max(30),
});
router.put('/settings/subcategories/:sid/fields', writeCat, validate(Fields),
  h(async (req) => { await cfg.setFields(Number(req.params['sid']), req.body.fields); return true; }));

const Team = z.object({
  name: text(120), leadUserId: z.coerce.number().int().nullish(), assignmentMethod: z.string().optional(), maxOpen: z.coerce.number().int().min(1).max(200).optional(),
  active: z.boolean().optional(), categoryIds: z.array(id).optional(), useDepartmentLead: z.boolean().optional(),
});
router.delete('/settings/teams/:id', writeTeams, h((req) => uvt.deleteTeam(Number(req.params['id']))));
router.delete('/settings/subcategories/:sid', writeCat, h((req) => uvc.deleteCategory(Number(req.params['sid']))));
router.get('/settings/teams', readTeams, h(() => uvt.listTeams()));
router.post('/settings/teams', writeTeams, validate(Team), h((req) => uvt.saveTeam(req.body)));
router.put('/settings/teams/:id', writeTeams, validate(Team), h((req) => uvt.saveTeam(req.body, Number(req.params['id']))));
router.put('/settings/teams/:id/members', writeTeams,
  validate(z.object({ members: z.array(z.object({ userId: id, privilege: z.enum(svc.PRIVILEGES), active: z.boolean().optional(), skills: z.array(z.string().max(60)).max(30).optional() })).max(200) })),
  h(async (req) => { await uvt.setMembers(Number(req.params['id']), req.body.members); return true; }));
const Cond = z.object({ type: z.enum(['subcategory', 'field', 'department', 'priority']), key: z.string().max(40).optional(), op: z.enum(['is', 'is_not']), value: z.string().max(120) });
const Rules = z.object({ rules: z.array(z.object({ name: text(160), conditions: z.array(Cond).min(1).max(10), teamId: id, active: z.boolean().optional() })).max(50) });
router.put('/settings/categories/:cid/rules', writeCat, validate(Rules), h(async (req) => { await cfg.setRules(Number(req.params['cid']), req.body.rules); return true; }));
router.post('/settings/categories/:cid/route-test', readCat,
  validate(z.object({ subcategoryId: id, fields: z.record(z.unknown()).optional(), departmentIds: z.array(z.coerce.number().int()).optional(), priority: z.string().optional() })),
  h((req) => cfg.testRouting(Number(req.params['cid']), req.body)));
router.get('/settings/users', readTeams, h((req) => cfg.searchUsers(String(req.query['q'] ?? ''))));

export default router;
