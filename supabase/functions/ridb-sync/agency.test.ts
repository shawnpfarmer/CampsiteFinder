import { assertEquals } from "jsr:@std/assert";
import { resolveAgency } from "./agency.ts";

Deno.test("resolveAgency maps a known USFS org abbreviation", () => {
  assertEquals(resolveAgency([{ OrgAbbrevName: "USFS" }]), "USFS");
});

Deno.test("resolveAgency maps RIDB's real Forest Service abbreviation 'FS' to USFS", () => {
  assertEquals(resolveAgency([{ OrgAbbrevName: "FS" }]), "USFS");
});

Deno.test("resolveAgency maps a known BLM org abbreviation", () => {
  assertEquals(resolveAgency([{ OrgAbbrevName: "BLM" }]), "BLM");
});

Deno.test("resolveAgency maps a known USACE org abbreviation", () => {
  assertEquals(resolveAgency([{ OrgAbbrevName: "USACE" }]), "USACE");
});

Deno.test("resolveAgency maps a known FWS org abbreviation", () => {
  assertEquals(resolveAgency([{ OrgAbbrevName: "FWS" }]), "FWS");
});

Deno.test("resolveAgency maps NPS so callers can explicitly skip it", () => {
  assertEquals(resolveAgency([{ OrgAbbrevName: "NPS" }]), "NPS");
});

Deno.test("resolveAgency is case-insensitive and trims whitespace", () => {
  assertEquals(resolveAgency([{ OrgAbbrevName: " usfs \n" }]), "USFS");
});

Deno.test("resolveAgency returns null for an unmapped abbreviation", () => {
  assertEquals(resolveAgency([{ OrgAbbrevName: "BOR" }]), null);
});

Deno.test("resolveAgency returns null when ORGANIZATION is missing", () => {
  assertEquals(resolveAgency(undefined), null);
});

Deno.test("resolveAgency returns null when ORGANIZATION is empty", () => {
  assertEquals(resolveAgency([]), null);
});
