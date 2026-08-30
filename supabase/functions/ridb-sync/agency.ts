export interface RidbOrganization {
  OrgID?: string;
  OrgName?: string;
  OrgAbbrevName?: string;
}

// RIDB's own abbreviations, keyed uppercase. If a live sync logs an
// unmapped abbreviation for one of the four target agencies, add it here
// rather than guessing — see ridb-sync/index.ts's skipped-count logging.
//
// Confirmed against a live sync (2026-08-30): RIDB's real ORGANIZATION
// abbreviation for the Forest Service is "FS", not "USFS" — the plan's
// draft was wrong and every USFS facility was silently skipped until this
// was added. "USFS" is kept as a defensive alias in case some other RIDB
// response shape uses the fuller form.
const ORG_ABBREV_TO_AGENCY: Record<string, string> = {
  FS: "USFS",
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
