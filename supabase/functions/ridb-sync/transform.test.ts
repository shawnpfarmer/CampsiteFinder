import { assertEquals } from "jsr:@std/assert";
import { toCampgroundRow } from "./transform.ts";

Deno.test("toCampgroundRow converts a USFS facility into a namespaced, PostGIS-ready row", () => {
  const facility = {
    FacilityID: "233118",
    FacilityName: "Birch Creek Campground",
    FacilityDescription: "A national forest campground.",
    FacilityLatitude: 46.1234,
    FacilityLongitude: -89.5678,
    FacilityReservationURL: "https://www.recreation.gov/camping/campgrounds/233118",
    FacilityDirections: "Take Forest Road 13 north.",
    FacilityPhone: "715-555-0100",
    FacilityEmail: "info@fs.fed.us",
    ORGANIZATION: [{ OrgID: "131", OrgName: "USDA Forest Service", OrgAbbrevName: "USFS" }],
  };

  const row = toCampgroundRow(facility);

  assertEquals(row?.id, "ridb:233118");
  assertEquals(row?.park_code, null);
  assertEquals(row?.name, "Birch Creek Campground");
  assertEquals(row?.location, "POINT(-89.5678 46.1234)");
  assertEquals(row?.agency, "USFS");
  assertEquals(row?.source, "ridb");
  assertEquals(row?.reservation_url, "https://www.recreation.gov/camping/campgrounds/233118");
  // FacilityDirections is free-text driving-directions prose, not a URL — it
  // must never end up in directions_url, which the UI renders as an <a href>.
  assertEquals(row?.directions_url, "");
});

Deno.test("toCampgroundRow converts a BLM facility", () => {
  const facility = {
    FacilityID: "500200",
    FacilityName: "Lake Vermilion Recreation Area",
    FacilityDescription: "",
    FacilityLatitude: 47.891,
    FacilityLongitude: -92.345,
    ORGANIZATION: [{ OrgID: "121", OrgName: "Bureau of Land Management", OrgAbbrevName: "BLM" }],
  };

  const row = toCampgroundRow(facility);

  assertEquals(row?.id, "ridb:500200");
  assertEquals(row?.agency, "BLM");
});

Deno.test("toCampgroundRow returns null when coordinates are missing", () => {
  const facility = {
    FacilityID: "999",
    FacilityName: "No Coords",
    FacilityDescription: "",
    FacilityLatitude: null,
    FacilityLongitude: null,
    ORGANIZATION: [{ OrgAbbrevName: "USFS" }],
  };

  assertEquals(toCampgroundRow(facility as any), null);
});

Deno.test("toCampgroundRow returns null when FacilityID is missing", () => {
  const facility = {
    FacilityID: "",
    FacilityName: "No Id",
    FacilityDescription: "",
    FacilityLatitude: 44.0,
    FacilityLongitude: -90.0,
    ORGANIZATION: [{ OrgAbbrevName: "USFS" }],
  };

  assertEquals(toCampgroundRow(facility), null);
});

Deno.test("toCampgroundRow returns null when FacilityName is missing", () => {
  const facility = {
    FacilityID: "998",
    FacilityName: "",
    FacilityDescription: "",
    FacilityLatitude: 44.0,
    FacilityLongitude: -90.0,
    ORGANIZATION: [{ OrgAbbrevName: "USFS" }],
  };

  assertEquals(toCampgroundRow(facility), null);
});

Deno.test("toCampgroundRow converts a facility whose FacilityTypeDescription is Campground", () => {
  const facility = {
    FacilityID: "4",
    FacilityName: "Typed Campground",
    FacilityDescription: "",
    FacilityLatitude: 44.0,
    FacilityLongitude: -90.0,
    FacilityTypeDescription: "Campground",
    ORGANIZATION: [{ OrgAbbrevName: "USFS" }],
  };

  const row = toCampgroundRow(facility);

  assertEquals(row?.id, "ridb:4");
});

Deno.test("toCampgroundRow skips a facility whose FacilityTypeDescription is not Campground", () => {
  const facility = {
    FacilityID: "5",
    FacilityName: "Some Trailhead",
    FacilityDescription: "",
    FacilityLatitude: 44.0,
    FacilityLongitude: -90.0,
    FacilityTypeDescription: "Trailhead",
    ORGANIZATION: [{ OrgAbbrevName: "USFS" }],
  };

  assertEquals(toCampgroundRow(facility), null);
});

Deno.test("toCampgroundRow skips a facility whose resolved agency is NPS (already covered by nps-sync)", () => {
  const facility = {
    FacilityID: "1",
    FacilityName: "Some NPS Facility Also In RIDB",
    FacilityDescription: "",
    FacilityLatitude: 44.0,
    FacilityLongitude: -90.0,
    ORGANIZATION: [{ OrgAbbrevName: "NPS" }],
  };

  assertEquals(toCampgroundRow(facility), null);
});

Deno.test("toCampgroundRow skips a facility with an unresolvable/bad organization", () => {
  const facility = {
    FacilityID: "2",
    FacilityName: "Some Facility With A Bad Org",
    FacilityDescription: "",
    FacilityLatitude: 44.0,
    FacilityLongitude: -90.0,
    ORGANIZATION: [{ OrgAbbrevName: "BOR" }],
  };

  assertEquals(toCampgroundRow(facility), null);
});

Deno.test("toCampgroundRow defaults optional text fields to empty strings and contact to phone/email", () => {
  const facility = {
    FacilityID: "3",
    FacilityName: "Minimal Facility",
    FacilityLatitude: 44.0,
    FacilityLongitude: -90.0,
    ORGANIZATION: [{ OrgAbbrevName: "USACE" }],
  };

  const row = toCampgroundRow(facility as any);

  assertEquals(row?.description, "");
  assertEquals(row?.reservation_url, "");
  assertEquals(row?.directions_url, "");
  assertEquals(row?.contact, { phone: "", email: "" });
  assertEquals(row?.amenities, {});
  assertEquals(row?.fees, []);
  assertEquals(row?.images, []);
});
