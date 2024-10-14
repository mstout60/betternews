import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

import { z } from "zod";

const EnvSchema = z.object({
    DATABASE_URL: z.string().url(),
});

const processEnv = EnvSchema.parse(process.env);

const queryClient = neon(processEnv.DATABASE_URL);
const db = drizzle(queryClient);
