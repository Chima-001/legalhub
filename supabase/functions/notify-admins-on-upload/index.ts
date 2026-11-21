// Existing per-upload function. Keep gateway JWT verification on. The signed INSERT is checked again here.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleUploadAlert } from './handler.mjs';

Deno.serve((request: Request) => {
  // The only RPC allowed before signature verification is a boolean check; it never returns contacts.
  const connect = () =>
    createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  let client: ReturnType<typeof connect> | undefined;
  return handleUploadAlert(request, {
    env: (name: string) => Deno.env.get(name),
    rpc: (name: string, args: Record<string, unknown>) => {
      client ??= connect();
      return client.rpc(name, args);
    },
  });
});
