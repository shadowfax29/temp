/**
 * Ticket attachments: files and videos added to a ticket, a reply or a note.
 * Files are kept on disk under a random name (never served as a public folder); a short-lived signed link is handed to someone who may see the ticket.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';

export const UPLOAD_DIR = path.resolve(process.env['TICKET_UPLOAD_DIR'] || path.join(process.cwd(), 'uploads', 'tickets'));
export const MAX_FILE_MB = 100;
export const MAX_FILES = 5;

const KINDS: Record<string, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
  video: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'],
  audio: ['mp3', 'wav', 'm4a', 'ogg'],
  file: ['pdf', 'txt', 'csv', 'log', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'zip'],
};
const ALLOWED = new Set(Object.values(KINDS).flat());
const ext = (name: string) => path.extname(name).slice(1).toLowerCase();

export type FileKind = 'image' | 'video' | 'audio' | 'file';
export const kindOf = (name: string): FileKind => (Object.entries(KINDS).find(([, list]) => list.includes(ext(name)))?.[0] as FileKind | undefined) ?? 'file';

/** What the service stores about an uploaded file */
export interface SavedFile { originalName: string; storedName: string; mime: string; size: number }

/** A name safe to show and to send in a header */
const cleanName = (n: string) => n.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '_').slice(0, 200) || 'file';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); cb(null, UPLOAD_DIR); },
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID().replace(/-/g, '')}.${ext(file.originalname)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: MAX_FILES },
  fileFilter: (_req, file, cb) => {
    // browsers send the name as latin1; keep the characters the person typed
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    if (!ALLOWED.has(ext(file.originalname))) return cb(AppError.badRequest(`"${file.originalname}": this kind of file cannot be attached. Allowed: ${[...ALLOWED].join(', ')}.`));
    cb(null, true);
  },
});

/** Reads up to MAX_FILES files from the form field "files" (multipart only; a JSON request passes straight through) */
export function uploadFiles(req: Request, res: Response, next: NextFunction) {
  upload.array('files', MAX_FILES)(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `A file is larger than ${MAX_FILE_MB} MB.` : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? `At most ${MAX_FILES} files at a time.` : err.message;
      return next(AppError.badRequest(msg));
    }
    next(err);
  });
}

export const uploaded = (req: Request): SavedFile[] =>
  ((req.files as Express.Multer.File[] | undefined) ?? []).map((f) => ({ originalName: cleanName(f.originalname), storedName: f.filename, mime: f.mimetype, size: f.size }));

export const pathOf = (storedName: string) => path.join(UPLOAD_DIR, path.basename(storedName));

export async function removeFiles(files: SavedFile[]) {
  await Promise.all(files.map((f) => fs.promises.unlink(pathOf(f.storedName)).catch(() => undefined)));
}

/** Throws the uploaded files away again when the request ends in an error (a validation or permission failure leaves nothing behind) */
export function discardOnError(req: Request, res: Response, next: NextFunction) {
  res.on('finish', () => { if (res.statusCode >= 400) void removeFiles(uploaded(req)); });
  next();
}

// ── signed links, so a <video> or <a> can open a file without a header

const LINK_MINUTES = 10;

export const signLink = (attachmentId: number | string, userId: number, kind: 'tkt' | 'uv' = 'tkt') =>
  jwt.sign({ a: String(attachmentId), u: userId, p: 'tkt-file', k: kind }, env.JWT_SECRET, { expiresIn: `${LINK_MINUTES}m` });

/** Which table a file link points into: the tool's own attachments, or the UVdesk ones */
export function linkKind(token: string): 'tkt' | 'uv' {
  try { return (jwt.verify(token, env.JWT_SECRET) as { k?: string }).k === 'uv' ? 'uv' : 'tkt'; } catch { return 'tkt'; }
}

export function readLink(token: string): { attachmentId: string; userId: number } {
  try {
    const p = jwt.verify(token, env.JWT_SECRET) as { a?: string; u?: number; p?: string };
    if (p.p !== 'tkt-file' || !p.a || !p.u) throw new Error('not a file link');
    return { attachmentId: p.a, userId: p.u };
  } catch {
    throw AppError.unauthorized('This link has expired. Open the ticket again.');
  }
}

export const INLINE = new Set<FileKind>(['image', 'video', 'audio']);
export { cleanName };
