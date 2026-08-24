import { createClient } from "jsr:@supabase/supabase-js@2";

// This function is invoked from the browser via supabase-js's
// functions.invoke('delete-account'), which sends an Authorization header --
// that makes it a CORS-preflighted request, so every response path (including
// the OPTIONS preflight itself) needs these headers present.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return new Response("Missing required environment variables", {
      status: 500,
      headers: corsHeaders,
    });
  }

  // Authenticate the caller using their own JWT (forwarded automatically by
  // supabase-js's functions.invoke) against the anon-key client -- this is
  // what proves *who* is asking, before any deletion happens. Only after
  // this succeeds do we reach for the service-role client, and only ever to
  // delete that same, now-known, caller.
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await callerClient.auth.getUser();
  if (authError || !user) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { error } = await adminClient.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("delete-account failed:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  return new Response(null, { status: 204, headers: corsHeaders });
});
