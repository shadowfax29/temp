/**
 * Sign-in in two steps, like Taskly: password, then a 6-digit code sent to the person's email.
 * Every attempt is written to the login log. Five wrong passwords or codes lock the email for 15 minutes.
 */
import crypto from 'crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type mysql from 'mysql2/promise';
import { z } from 'zod';
import { pool } from '../../config/db';
import { env } from '../../config/env';
import { authenticateAny } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { AppError } from '../../utils/AppError';
import { mailConfigured, sendMail } from '../../utils/mailer';
import { sendSuccess } from '../../utils/response';
import { privilegesOf } from '../access/access.service';
import { CATALOG } from '../access/catalog';
import { logLogin, recentFailures } from './loginlog.service';
import { checkNewPassword } from '../../utils/password';
import { hashPassword, setPassword, verifyPassword } from '../access/people.service';

type Row = mysql.RowDataPacket;
const router = Router();

const MAX_FAILURES = 5;
const CODE_MINUTES = 10;

async function twoFactorOn(userSetting: unknown): Promise<boolean> {
  if (userSetting === 0 || userSetting === 1) return userSetting === 1;
  const [r] = await pool.query<Row[]>(`SELECT SettingValue FROM AppSetting WHERE SettingKey = 'twoFactorDefault'`);
  return (r[0]?.['SettingValue'] ?? 'on') !== 'off';
}

async function issueToken(u: { UserID: number; UserEmail: string; UserName: string; RoleID: number; MustChangePassword?: number }) {
  const mcp = Number(u.MustChangePassword) === 1;
  const token = jwt.sign({ sub: String(u['UserID']), email: u['UserEmail'], role: u['RoleID'], username: u['UserName'], ...(mcp ? { mcp: true } : {}) }, env.JWT_SECRET, { expiresIn: (mcp ? '30m' : env.JWT_EXPIRES_IN) } as jwt.SignOptions);
  return { token, mustChangePassword: mcp, user: { userId: u['UserID'], name: u['UserName'], email: u['UserEmail'], privileges: await privilegesOf(u['UserID']) } };
}

const mask = (email: string) => email.replace(/^(.).*(@.*)$/, '$1***$2');

router.post('/login', validate(z.object({ email: z.string().trim().email(), password: z.string().min(1).max(200) })), async (req, res, next) => {
  const email = String(req.body.email).toLowerCase();
  try {
    if ((await recentFailures(email)) >= MAX_FAILURES) {
      await logLogin(req, 'LOCKED', email, null, 'Too many wrong attempts');
      throw new AppError('Too many wrong attempts. Try again in 15 minutes.', 429);
    }
    const [r] = await pool.query<Row[]>(
      `SELECT u.UserID, u.UserName, u.UserEmail, u.PasswordHash, u.RoleID, u.TwoFactor, u.MustChangePassword FROM Users u JOIN AMRole ro ON ro.RoleID = u.RoleID
       WHERE u.UserEmail = ? AND u.UserStatus = 1 AND u.IsUserArchived = 0 AND ro.RoleStatus = 1`, [email]);
    const u = r[0];
    // the same message for an unknown email and a wrong password
    const check = u ? await verifyPassword(req.body.password, u['PasswordHash']) : { ok: false, upgrade: false };
    if (!u || !check.ok) {
      await logLogin(req, 'PASSWORD_FAILED', email, u ? u['UserID'] : null, u ? 'Wrong password' : 'Unknown email');
      throw AppError.unauthorized('Wrong email or password.');
    }
    // a password saved by UVdesk (Argon2) is quietly re-saved in this tool's format now that it is known to be right
    if (check.upgrade) await setPassword(u['UserID'], await hashPassword(req.body.password), Number(u['MustChangePassword']) === 1);
    if (!(await twoFactorOn(u['TwoFactor']))) {
      await logLogin(req, 'LOGIN_OK', email, u['UserID'], 'Password only (two-step sign-in is off for this person)');
      sendSuccess(res, { needsOtp: false, ...(await issueToken({ UserID: u['UserID'], UserEmail: u['UserEmail'], UserName: u['UserName'], RoleID: u['RoleID'], MustChangePassword: u['MustChangePassword'] })) });
      return;
    }
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const challengeId = crypto.randomUUID();
    await pool.query('INSERT INTO LoginChallenge (ChallengeID, UserID, CodeHash, ExpiresAt) VALUES (?,?,?, NOW() + INTERVAL ? MINUTE)', [challengeId, u['UserID'], await bcrypt.hash(code, 8), CODE_MINUTES]);
    const sent = await sendMail(email, 'Your sign-in code', `Your code is ${code}. It works for ${CODE_MINUTES} minutes. If this was not you, change your password.`);
    await logLogin(req, 'OTP_SENT', email, u['UserID'], sent ? 'Code emailed' : 'Code not emailed (no mail server set up)');
    // .local addresses are not real mailboxes; show the code on screen for them even if SMTP accepted the message.
    const showOnScreen = !sent || email.split('@')[1]?.endsWith('.local');
    sendSuccess(res, { needsOtp: true, challengeId, emailHint: mask(email), expiresInMinutes: CODE_MINUTES, mailConfigured: mailConfigured(), ...(showOnScreen ? { devOtp: code } : {}) });
  } catch (e) { next(e); }
});

router.post('/verify-otp', validate(z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') })), async (req, res, next) => {
  try {
    const [c] = await pool.query<Row[]>(
      `SELECT c.*, u.UserName, u.UserEmail, u.RoleID, u.MustChangePassword, (c.ExpiresAt < NOW()) AS expired FROM LoginChallenge c JOIN Users u ON u.UserID = c.UserID WHERE c.ChallengeID = ?`, [req.body.challengeId]);
    const ch = c[0];
    if (!ch || ch['UsedAt'] || Number(ch['expired'])) throw AppError.unauthorized('That code has expired. Sign in again to get a new one.');
    const email = String(ch['UserEmail']).toLowerCase();
    if (Number(ch['Attempts']) >= MAX_FAILURES) { await logLogin(req, 'LOCKED', email, ch['UserID'], 'Too many wrong codes'); throw AppError.unauthorized('Too many wrong codes. Sign in again to get a new one.'); }
    if (!(await bcrypt.compare(req.body.code, ch['CodeHash']))) {
      await pool.query('UPDATE LoginChallenge SET Attempts = Attempts + 1 WHERE ChallengeID = ?', [ch['ChallengeID']]);
      await logLogin(req, 'OTP_FAILED', email, ch['UserID'], 'Wrong code');
      throw AppError.unauthorized('That code is not right.');
    }
    await pool.query('UPDATE LoginChallenge SET UsedAt = NOW() WHERE ChallengeID = ?', [ch['ChallengeID']]);
    await logLogin(req, 'LOGIN_OK', email, ch['UserID'], 'Password and code');
    sendSuccess(res, await issueToken({ UserID: ch['UserID'], UserEmail: ch['UserEmail'], UserName: ch['UserName'], RoleID: ch['RoleID'], MustChangePassword: ch['MustChangePassword'] }));
  } catch (e) { next(e); }
});

router.post('/change-password', authenticateAny, validate(z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) })), async (req, res, next) => {
  try {
    const id = Number(req.user!.sub);
    const [r] = await pool.query<Row[]>('SELECT UserID, UserName, UserEmail, PasswordHash, RoleID FROM Users WHERE UserID = ? AND UserStatus = 1 AND IsUserArchived = 0', [id]);
    const u = r[0];
    if (!u || !(await verifyPassword(req.body.currentPassword, u['PasswordHash'])).ok) {
      await logLogin(req, 'PASSWORD_FAILED', req.user!.email, id, 'Wrong current password while changing it');
      throw AppError.badRequest('The current password is not right.');
    }
    checkNewPassword(req.body.newPassword, u['UserEmail']);
    if (req.body.newPassword === req.body.currentPassword) throw AppError.badRequest('Choose a password that is different from the current one.');
    await setPassword(id, await hashPassword(req.body.newPassword), false);
    await logLogin(req, 'PASSWORD_CHANGED', u['UserEmail'], id, 'Password changed');
    sendSuccess(res, await issueToken({ UserID: u['UserID'], UserEmail: u['UserEmail'], UserName: u['UserName'], RoleID: u['RoleID'], MustChangePassword: 0 }));
  } catch (e) { next(e); }
});

router.post('/forgot-password', validate(z.object({ email: z.string().trim().email() })), async (req, res, next) => {
  try {
    const email = String(req.body.email).toLowerCase();
    const [r] = await pool.query<Row[]>('SELECT UserID, UserName FROM Users WHERE UserEmail = ? AND UserStatus = 1 AND IsUserArchived = 0', [email]);
    if (r[0]) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await pool.query('INSERT INTO PasswordReset (user_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)', [r[0]['UserID'], tokenHash]);
      const link = `${env.FRONTEND_URL}/reset-password?token=${token}`;
      await sendMail(email, 'Reset your Ticketing Tool password',
        `Hello ${r[0]['UserName']},\n\nClick the link below to reset your password. It works for 1 hour.\n\n${link}\n\nIf you did not request this, ignore this email.`);
    }
    // Always respond OK — do not reveal whether the email exists
    sendSuccess(res, { ok: true });
  } catch (e) { next(e); }
});

router.post('/reset-password', validate(z.object({ token: z.string().min(1), newPassword: z.string().min(1).max(200) })), async (req, res, next) => {
  try {
    const tokenHash = crypto.createHash('sha256').update(String(req.body.token)).digest('hex');
    const [r] = await pool.query<Row[]>(
      `SELECT pr.id, pr.user_id, u.UserEmail, u.UserName, (pr.expires_at < NOW()) AS expired, pr.used_at
       FROM PasswordReset pr JOIN Users u ON u.UserID = pr.user_id WHERE pr.token_hash = ?`, [tokenHash]);
    const reset = r[0];
    if (!reset || reset['used_at'] || Number(reset['expired'])) throw AppError.badRequest('This link has expired or already been used. Request a new one.');
    checkNewPassword(req.body.newPassword, reset['UserEmail']);
    await setPassword(Number(reset['user_id']), await hashPassword(req.body.newPassword), false);
    await pool.query('UPDATE PasswordReset SET used_at = NOW() WHERE id = ?', [reset['id']]);
    await logLogin(req, 'PASSWORD_CHANGED', String(reset['UserEmail']), Number(reset['user_id']), 'Password reset via email link');
    sendSuccess(res, { ok: true });
  } catch (e) { next(e); }
});

router.post('/logout', authenticateAny, async (req, res) => {
  await logLogin(req, 'LOGOUT', req.user!.email, Number(req.user!.sub));
  sendSuccess(res, { ok: true });
});

router.get('/me', authenticateAny, async (req, res, next) => {
  try { sendSuccess(res, { mustChangePassword: !!req.user!.mcp, userId: Number(req.user!.sub), name: req.user!.username, email: req.user!.email, privileges: await privilegesOf(Number(req.user!.sub)) }); }
  catch (e) { next(e); }
});

router.get('/catalog', authenticateAny, (_req, res) => { sendSuccess(res, CATALOG); });

export default router;
