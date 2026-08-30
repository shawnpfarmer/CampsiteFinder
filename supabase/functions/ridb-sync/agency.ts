export interface RidbOrganization {
  OrgID?: string;
  OrgName?: string;
  OrgAbbrevName?: string;
}

// RIDB's own abbreviations, keyed uppercase. If a live sync logs an
// unmapped abbreviation for one of the four target agencies, add it here
// rather than guessing — see ridb-sync/index.ts's skipped-count logging.
const ORG_ABBREV_TO_AGENCY: Record<string, string> = {
  USFS: "USFS",
  BLM: "BLM",
  USACE: "USACE",
  FWS: "FWS",
  NPS: "NPS",
};

export function resolveAgency(organizations: RidbOrganization[] | undefined): string | null {
  const abbrev = organizations?.[0]?.OrgAbbrevName?.trim().toUpperCase();
  if (!abbrev) return null;
  return ORG_ABBREV_TO_AGENCY[abbrev] ?? null;
}
