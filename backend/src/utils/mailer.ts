import nodemailer from 'nodemailer';
import { logger } from '../config/logger';

/** Mail is sent only when SMTP_HOST is set in .env; otherwise the caller falls back (the sign-in code is shown in development only) */
export const mailConfigured = () => !!process.env['SMTP_HOST'];

export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  if (!mailConfigured()) return false;
  try {
    const t = nodemailer.createTransport({
      host: process.env['SMTP_HOST'], port: Number(process.env['SMTP_PORT'] || 587), secure: Number(process.env['SMTP_PORT']) === 465,
      auth: process.env['SMTP_USER'] ? { user: process.env['SMTP_USER'], pass: process.env['SMTP_PASS'] } : undefined,
    });
    await t.sendMail({ from: process.env['SMTP_FROM'] || 'no-reply@ticketing.local', to, subject, text });
    return true;
  } catch (err) {
    logger.warn({ err }, 'Could not send mail');
    return false;
  }
}
