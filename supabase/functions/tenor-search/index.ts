import { createTenorSearchHandler } from './handler.mjs';

Deno.serve(createTenorSearchHandler({
  getEnv: (name) => Deno.env.get(name),
}));
