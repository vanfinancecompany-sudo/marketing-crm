import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { completedDayGa4Comparison } from "../api/_ga4-data-api.js";

function days(values) {
  return values.map((value,i) => ({ dimensions:{date:"202610"+String(9+i)},metrics:{activeUsers:value} }));
}

test("GA4 compares yesterday with seven complete preceding days, not partial today", () => {
  const result = completedDayGa4Comparison({
    yesterdayMetrics:{activeUsers:120}, dailyRows:days([100,100,100,100,100,100,100]),
  });
  assert.equal(result.usersYesterday,120);
  assert.equal(result.sevenDayAverageUsers,100);
  assert.equal(result.usersVsSevenDayPct,20);
  assert.equal(result.completedDayComparisonReady,true);
  assert.equal(result.comparisonPeriod,"yesterday_vs_previous_seven_days");
});

test("a zero yesterday while GA4 still processes does not become a bogus -100% decline", () => {
  const result=completedDayGa4Comparison({
    yesterdayMetrics:{activeUsers:0}, dailyRows:days([120,110,150,130,140,120,130]),
  });
  assert.equal(result.usersVsSevenDayPct,null);
  assert.equal(result.completedDayComparisonReady,false);
  assert.match(result.comparisonNote,/processing/i);
});

test("no GA4 baseline returns unavailable, not a traffic change", () => {
  const result=completedDayGa4Comparison({yesterdayMetrics:{activeUsers:0},dailyRows:[]});
  assert.equal(result.sevenDayAverageUsers,null);
  assert.equal(result.usersVsSevenDayPct,null);
  assert.equal(result.completedDayComparisonReady,false);
});

test("baseline denominator includes all seven dates even when GA4 omits zero-row dates", () => {
  const result=completedDayGa4Comparison({yesterdayMetrics:{activeUsers:10},dailyRows:days([70])});
  assert.equal(result.sevenDayAverageUsers,10);
  assert.equal(result.usersVsSevenDayPct,0);
});

test("GA4 code uses yesterday and preceding full week and dashboard labels all today's stats provisional", () => {
  const api=fs.readFileSync(new URL("../api/_ga4-data-api.js",import.meta.url),"utf8");
  const panel=fs.readFileSync(new URL("../components/Ga4PipelinePanel.jsx",import.meta.url),"utf8");
  assert.match(api,/startDate:'yesterday',endDate:'yesterday'/);
  assert.match(api,/startDate:'8daysAgo',endDate:'2daysAgo'/);
  assert.doesNotMatch(api,/pctChange\(number\(today.activeUsers\)/);
  assert.match(panel,/Users today · provisional/);
  assert.match(panel,/no traffic-drop verdict/);
  assert.match(panel,/yesterday vs prior 7 days/);
});
