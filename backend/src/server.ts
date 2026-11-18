import { app } from './app';
import { env } from './config/env';
import { logger } from './config/logger';

app.listen(env.PORT, () => { logger.info(`Ticketing tool API on http://localhost:${env.PORT}`); });
