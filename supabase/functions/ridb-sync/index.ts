import { createClient } from "jsr:@supabase/supabase-js@2";
import { toCampgroundRow } from "./transform.ts";
import { resolveAgency } from "./agency.ts";

const RIDB_API_BASE = "https://ridb.recreation.gov/api/v1";
const CAMPING_ACTIVITY_ID = "9";

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
  // Breakdown of why a facility was skipped, plus the raw set of org
  // abbreviations RIDB sent that we couldn't map to one of our four target
  // agencies — see agency.ts's ORG_ABBREV_TO_AGENCY comment. This is what
  // makes an opaque `skipped: 2000` actionable on the first live run.
  const skipReasons = { noId: 0, noName: 0, badCoords: 0, nonTargetAgency: 0, wrongType: 0 };
  const unmappedOrgAbbrevs = new Set<string>();

  try {
    while (offset < total) {
      const url =
        `${RIDB_API_BASE}/facilities?activity=${CAMPING_ACTIVITY_ID}` +
        `&full=true&limit=${limit}&offset=${offset}`;
      const response = await fetch(url, {
        headers: { apikey: ridbApiKey, Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`RIDB API request failed: ${response.status}`);
      }
      const body = await response.json();
      total = body.METADATA.RESULTS.TOTAL_COUNT;

      const rows = [];
      for (const facility of body.RECDATA) {
        const row = toCampgroundRow(facility);
        if (row !== null) {
          rows.push(row);
          continue;
        }

        skipped++;
        if (!facility.FacilityID) {
          skipReasons.noId++;
        } else if (!facility.FacilityName) {
          skipReasons.noName++;
        } else if (
          facility.FacilityLatitude == null || facility.FacilityLongitude == null ||
          Number.isNaN(facility.FacilityLatitude) || Number.isNaN(facility.FacilityLongitude)
        ) {
          skipReasons.badCoords++;
        } else {
          const agency = resolveAgency(facility.ORGANIZATION);
          if (!agency || agency === "NPS") {
            skipReasons.nonTargetAgency++;
            if (!agency) {
              const abbrev = facility.ORGANIZATION?.[0]?.OrgAbbrevName;
              if (abbrev) unmappedOrgAbbrevs.add(abbrev);
            }
          } else {
            skipReasons.wrongType++;
          }
        }
      }

      if (rows.length > 0) {
        const { error } = await supabase.from("campgrounds").upsert(rows);
        if (error) throw error;
        upserted += rows.length;
      }

      offset += limit;
    }

    console.log("ridb-sync skip breakdown:", {
      skipped,
      ...skipReasons,
      unmappedOrgAbbrevs: [...unmappedOrgAbbrevs],
    });

    return new Response(
      JSON.stringify({
        upserted,
        skipped,
        skipReasons,
        unmappedOrgAbbrevs: [...unmappedOrgAbbrevs],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("ridb-sync failed, existing data retained:", err);
    return new Response(`Sync failed: ${(err as Error).message}`, { status: 500 });
  }
});
