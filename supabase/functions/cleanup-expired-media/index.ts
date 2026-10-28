import { createExpiredMediaCleanupHandler } from './handler.mjs';

Deno.serve(createExpiredMediaCleanupHandler({
  getEnv: (name) => Deno.env.get(name),
}));
