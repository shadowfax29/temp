import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import { can } from '../modules/access/access.service';
import type { Action } from '../modules/access/catalog';

/** Lets the request through only when the signed-in user holds `action` on `module` */
export function requireModule(module: string, action: Action = 'read') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const userId = Number(req.user?.sub);
    if (!userId) return next(AppError.unauthorized('Please sign in'));
    can(userId, module, action)
      .then((ok) => (ok ? next() : next(AppError.forbidden(`You do not have access to ${module} (${action}).`))))
      .catch(next);
  };
}
