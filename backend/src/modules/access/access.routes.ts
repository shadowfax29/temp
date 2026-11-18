import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middlewares/auth';
import { requireModule } from '../../middlewares/permission';
import { validate } from '../../middlewares/validate';
import { sendSuccess } from '../../utils/response';
import * as svc from './access.service';
import { listLoginLogs } from '../auth/loginlog.service';

const router = Router();
router.use(authenticate);
const h = (fn: (req: Request) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req).then((d) => sendSuccess(res, d)).catch(next); };

const Role = z.object({ roleName: z.string().trim().min(1).max(120), description: z.string().max(255).optional(), active: z.boolean().optional(), privileges: z.record(z.array(z.string())) });
router.get('/roles', requireModule('adm_roles', 'read'), h(() => svc.listRoles()));
router.post('/roles', requireModule('adm_roles', 'create'), validate(Role), h((req) => svc.saveRole(req.body)));
router.put('/roles/:id', requireModule('adm_roles', 'update'), validate(Role), h((req) => svc.saveRole({ ...req.body, roleId: Number(req.params['id']) })));
router.delete('/roles/:id', requireModule('adm_roles', 'delete'), h((req) => svc.deleteRole(Number(req.params['id']))));

const User = z.object({ name: z.string().trim().min(1).max(160), email: z.string().trim().email().max(190), roleId: z.coerce.number().int().positive(), active: z.boolean().optional(), resetPassword: z.boolean().optional(), teamIds: z.array(z.coerce.number().int().positive()).optional(), leadTeamIds: z.array(z.coerce.number().int().positive()).optional(), twoFactor: z.boolean().nullable().optional() });
router.get('/login-logs', requireModule('adm_logs', 'read'), h((req) => listLoginLogs({ event: req.query['event'] as string | undefined, email: req.query['email'] as string | undefined, from: req.query['from'] as string | undefined, to: req.query['to'] as string | undefined, page: Number(req.query['page']) || 1, size: Number(req.query['size']) || 50 })));
router.get('/two-factor', requireModule('adm_users', 'read'), h(() => svc.getTwoFactorDefault()));
router.put('/two-factor', requireModule('adm_users', 'update'), validate(z.object({ on: z.boolean() })), h((req) => svc.setTwoFactorDefault(req.body.on)));
router.get('/teams', requireModule('adm_users', 'read'), h(() => svc.listTeamsLite()));
router.get('/users', requireModule('adm_users', 'read'), h(() => svc.listUsers()));
router.post('/users', requireModule('adm_users', 'create'), validate(User), h((req) => svc.saveUser(req.body)));
router.put('/users/:id', requireModule('adm_users', 'update'), validate(User), h((req) => svc.saveUser({ ...req.body, userId: Number(req.params['id']) })));

export default router;
