import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

export interface JwtPayload { sub: string; email: string; role: number; username: string; mcp?: boolean; iat?: number; exp?: number }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { user?: JwtPayload }
  }
}

/** Signed in, and no temporary password left to replace */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  authenticateAny(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (req.user?.mcp) return next(AppError.forbidden('Choose your own password first.', 'PASSWORD_CHANGE_REQUIRED'));
    next();
  });
}

/** Signed in, even when a temporary password still has to be replaced (only for sign-out, who-am-I and change-password) */
export function authenticateAny(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next(AppError.unauthorized('Please sign in.'));
  try {
    req.user = jwt.verify(header.slice(7), env.JWT_SECRET) as JwtPayload;
    next();
  } catch (err) {
    next(err instanceof jwt.TokenExpiredError ? AppError.unauthorized('Your session expired. Please sign in again.', 'SESSION_EXPIRED') : AppError.unauthorized('Please sign in again.', 'SESSION_INVALID'));
  }
}
