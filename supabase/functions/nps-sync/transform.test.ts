import { assertEquals } from "jsr:@std/assert";
import { toCampgroundRow } from "./transform.ts";

Deno.test("toCampgroundRow converts an NPS record into a PostGIS-ready row", () => {
  const record = {
    id: "abc123",
    parkCode: "acad",
    name: "Blackwoods Campground",
    description: "A campground in Acadia.",
    latitude: "44.3106",
    longitude: "-68.2044",
    amenities: { showers: "Yes" },
    fees: [{ cost: "30.00", description: "Per night" }],
    reservationUrl: "https://www.recreation.gov/camping/campgrounds/232473",
    directionsUrl: "https://www.nps.gov/acad/planyourvisit/camping.htm",
    images: [],
    contacts: {},
  };

  const row = toCampgroundRow(record);

  assertEquals(row?.id, "abc123");
  assertEquals(row?.location, "POINT(-68.2044 44.3106)");
  assertEquals(row?.park_code, "acad");
});

Deno.test("toCampgroundRow returns null when coordinates are missing", () => {
  const record = {
    id: "bad1",
    parkCode: "acad",
    name: "No Coords",
    description: "",
    latitude: "",
    longitude: "",
    amenities: {},
    fees: [],
    reservationUrl: "",
    directionsUrl: "",
    images: [],
    contacts: {},
  };

  assertEquals(toCampgroundRow(record), null);
});

Deno.test("toCampgroundRow reads state from the Physical address entry", () => {
  const record = {
    id: "phys1",
    parkCode: "acad",
    name: "Physical Address Campground",
    description: "",
    latitude: "44.3106",
    longitude: "-68.2044",
    amenities: {},
    fees: [],
    reservationUrl: "",
    directionsUrl: "",
    images: [],
    contacts: {},
    addresses: [
      { type: "Mailing", stateCode: "DC" },
      { type: "Physical", stateCode: "ME" },
    ],
  };

  const row = toCampgroundRow(record as any);

  assertEquals(row?.state, "ME");
});

Deno.test("toCampgroundRow falls back to the first address when none is typed Physical", () => {
  const record = {
    id: "mail1",
    parkCode: "acad",
    name: "Mailing Only Campground",
    description: "",
    latitude: "44.3106",
    longitude: "-68.2044",
    amenities: {},
    fees: [],
    reservationUrl: "",
    directionsUrl: "",
    images: [],
    contacts: {},
    addresses: [{ type: "Mailing", stateCode: "ME" }],
  };

  const row = toCampgroundRow(record as any);

  assertEquals(row?.state, "ME");
});

Deno.test("toCampgroundRow sets state to null when no address is present", () => {
  const record = {
    id: "noaddr1",
    parkCode: "acad",
    name: "No Address Campground",
    description: "",
    latitude: "44.3106",
    longitude: "-68.2044",
    amenities: {},
    fees: [],
    reservationUrl: "",
    directionsUrl: "",
    images: [],
    contacts: {},
  };

  const row = toCampgroundRow(record as any);

  assertEquals(row?.state, null);
});
