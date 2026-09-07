import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function slots(start, end) {
  const minutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const format = (value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  const result = [];
  for (let value = minutes(start); value + 20 <= minutes(end); value += 20) result.push(format(value));
  return result;
}

const expected = new Map([
  ["Danilo:1", [...slots("09:00", "12:00"), ...slots("14:00", "18:00")]],
  ["Danilo:2", slots("14:00", "18:00")],
  ["Danilo:3", slots("09:00", "12:00")],
  ["Danilo:4", [...slots("09:00", "12:00"), ...slots("14:00", "18:00")]],
  ["Danilo:5", slots("14:00", "18:00")],
  ["Wagner:2", slots("09:00", "12:00")],
  ["Wagner:3", slots("14:00", "18:00")],
  ["Wagner:5", slots("09:00", "12:00")],
  ["Deison:3", slots("15:00", "16:40")],
  ["Deison:5", slots("15:00", "16:40")],
]);

test("migration persiste exatamente a grade semanal oficial em períodos de 20 minutos", async () => {
  const sql = await readFile(new URL("../migrations/006_create_recurring_schedules_and_blocks.sql", import.meta.url), "utf8");
  const rows = [...sql.matchAll(/\('(?:Dr\. )?([^']+)',\s*(\d),\s*'(\d\d:\d\d)'::time,\s*'(\d\d:\d\d)'::time\)/g)]
    .map((match) => ({ doctor: match[1], weekday: match[2], start: match[3], end: match[4] }));
  assert.equal(rows.length, 12);
  const actual = new Map();
  for (const row of rows) {
    const key = `${row.doctor}:${row.weekday}`;
    actual.set(key, [...(actual.get(key) ?? []), ...slots(row.start, row.end)]);
  }
  assert.deepEqual(actual, expected);
  assert.equal([...actual.values()].flat().includes("12:00"), false);
  assert.equal(actual.get("Danilo:1").includes("13:00"), false);
  assert.equal([...actual.values()].flat().includes("18:00"), false);
  assert.equal([...actual.keys()].some((key) => key.endsWith(":6") || key.endsWith(":7")), false);
});

test("Deison termina às 16:40 e possui último início às 16:20", () => {
  assert.deepEqual(expected.get("Deison:3"), ["15:00", "15:20", "15:40", "16:00", "16:20"]);
  assert.deepEqual(expected.get("Deison:5"), ["15:00", "15:20", "15:40", "16:00", "16:20"]);
});
