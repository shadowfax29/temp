import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8090),

  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().default(3306),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string().default('ticketdesk'),
  DB_POOL_MIN: z.coerce.number().default(2),
  DB_POOL_MAX: z.coerce.number().default(10),
  DB_ACQUIRE_TIMEOUT: z.coerce.number().default(30000),
  DB_IDLE_TIMEOUT: z.coerce.number().default(10000),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('8h'),

  FRONTEND_URL: z.string().default('http://localhost:3040'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const errors = JSON.stringify(parsed.error.flatten().fieldErrors);
  throw new Error(`Invalid environment variables: ${errors}`);
}

export const env = parsed.data;
