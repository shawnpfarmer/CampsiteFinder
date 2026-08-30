import { createClient } from "jsr:@supabase/supabase-js@2";
import { toCampgroundRow } from "./transform.ts";

const RIDB_API_BASE = "https://ridb.recreation.gov/api/v1";
const CAMPING_ACTIVITY_ID = "9";

// US Census Bureau Midwest region — the region this sync exists to cover
// (see docs/superpowers/specs/2026-08-28-ridb-midwest-analysis.md). RIDB's
// `state` param accepts a comma-delimited list; widen this array to expand
// coverage later without any other code change.
const MIDWEST_STATES = ["IL", "IN", "IA", "KS", "MI", "MN", "MO", "NE", "ND", "OH", "SD", "WI"];

Deno.serve(async (_req) => {
  const ridbApiKey = Deno.env.get("RIDB_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!ridbApiKey || !supabaseUrl || !serviceRoleKey) {
    return new Response("Missing required environment variables", { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let offset = 0;
  const limit = 50;
  let total = Infinity;
  let upserted = 0;
  let skipped = 0;

  try {
    while (offset < total) {
      const url =
        `${RIDB_API_BASE}/facilities?state=${MIDWEST_STATES.join(",")}` +
        `&activity=${CAMPING_ACTIVITY_ID}&full=true&limit=${limit}&offset=${offset}`;
      const response = await fetch(url, {
        headers: { apikey: ridbApiKey, Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`RIDB API request failed: ${response.status}`);
      }
      const body = await response.json();
      total = body.METADATA.RESULTS.TOTAL_COUNT;

      const rows = body.RECDATA
        .map(toCampgroundRow)
        .filter((row: unknown) => row !== null);
      skipped += body.RECDATA.length - rows.length;

      if (rows.length > 0) {
        const { error } = await supabase.from("campgrounds").upsert(rows);
        if (error) throw error;
        upserted += rows.length;
      }

      offset += limit;
    }

    return new Response(
      JSON.stringify({ upserted, skipped }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("ridb-sync failed, existing data retained:", err);
    return new Response(`Sync failed: ${(err as Error).message}`, { status: 500 });
  }
});
