import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler } from './middlewares/errorHandler';
import { requestId } from './middlewares/requestId';
import authRouter from './modules/auth/auth.routes';
import accessRouter from './modules/access/access.routes';
import ticketingRouter from './modules/ticketing/ticketing.routes';

export const app = express();
app.use(helmet());
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(requestId);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
app.use('/api/auth', authRouter);
app.use('/api/admin', accessRouter);
app.use('/api/ticketing', ticketingRouter);
app.use(errorHandler);
