import { test } from "node:test";
import assert from "node:assert/strict";
import { extractNumber, normalizePurity } from "../src/index.js";

test("extractNumber mimics VALUE(SUBSTITUTE(REGEXEXTRACT(...),',',''))", () => {
  assert.equal(extractNumber("₹14,826"), 14826);
  assert.equal(extractNumber("&#x20b9;14,826"), 14826);
  assert.equal(extractNumber("&#8377;1,18,608"), 118608);
  assert.equal(extractNumber("₹14,826 (-103)"), 14826);
  assert.equal(extractNumber(" ₹1,18,608 "), 118608);
  assert.equal(extractNumber("8"), 8);
});

test("extractNumber returns null when no number is present", () => {
  assert.equal(extractNumber("Gram"), null);
  assert.equal(extractNumber(""), null);
  assert.equal(extractNumber(undefined), null);
});

test("normalizePurity maps 24/22/18 (any case) to table keys", () => {
  assert.equal(normalizePurity("24"), "24K");
  assert.equal(normalizePurity("22"), "22K");
  assert.equal(normalizePurity("18"), "18K");
  assert.equal(normalizePurity("24k"), "24K");
  assert.equal(normalizePurity(" 22K "), "22K");
});

test("normalizePurity rejects unsupported values", () => {
  assert.equal(normalizePurity("20"), null);
  assert.equal(normalizePurity("24K gold"), null);
  assert.equal(normalizePurity(""), null);
  assert.equal(normalizePurity(undefined), null);
});
