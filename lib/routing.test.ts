import { describe, expect, it } from "vitest";
import { buildWalkGraph, estimatedAccess, findJourneyOptions, meters, planJourney, profileForDate } from "./routing";
import type { DayProfile, ScheduleData, Stop } from "./types";

const stops: Stop[] = [
  { id: "a", name: "A", lat: 46.05, lon: 14.50 },
  { id: "b", name: "B", lat: 46.05, lon: 14.51 },
  { id: "c", name: "C", lat: 46.05, lon: 14.52 },
];
const profile: DayProfile = {
  date: "2026-07-20",
  trips: [[0, "C", ""]],
  patterns: [[0, "C", "", [0, 1, 2]]],
  connections: [
    [8 * 3600 + 5 * 60, 8 * 3600 + 10 * 60, 0, 1, 0, 0],
    [8 * 3600 + 10 * 60, 8 * 3600 + 15 * 60, 1, 2, 0, 0],
  ],
};

describe("routing core", () => {
  it("calculates Ljubljana distances in metres", () => {
    expect(meters(stops[0], stops[1])).toBeGreaterThan(700);
    expect(meters(stops[0], stops[1])).toBeLessThan(800);
  });

  it("selects an exact dated profile and falls back safely", () => {
    const schedule: ScheduleData = { generatedAt: "", profiles: { p0: profile }, dateProfiles: { "2026-07-20": "p0" }, fallbackProfiles: { weekday: "p0" }, shapes: {} };
    expect(profileForDate(schedule, "2026-07-20")).toEqual({ profile, exact: true });
    expect(profileForDate(schedule, "2026-07-21")).toEqual({ profile, exact: false });
  });

  it("builds a journey with one continuous bus ride", () => {
    const graph = buildWalkGraph(stops, 100);
    const journey = planJourney(profile, 8 * 3600, graph, [{ stop: 0, seconds: 60, distance: 70 }], [{ stop: 2, seconds: 60, distance: 70 }]);
    expect(journey).not.toBeNull();
    expect(journey?.arrival).toBe(8 * 3600 + 16 * 60);
    expect(journey?.steps.filter(step => step.kind === "ride")).toHaveLength(1);
    expect(journey?.transfers).toBe(0);
  });

  it("returns labelled route alternatives without duplicates", () => {
    const graph = buildWalkGraph(stops, 100);
    const options = findJourneyOptions(profile, 8 * 3600, graph, [{ stop: 0, seconds: 60, distance: 70 }], [{ stop: 2, seconds: 60, distance: 70 }]);
    expect(options).toHaveLength(1);
    expect(options[0].label).toBe("Najhitrejša");
  });

  it("limits address access to the nearest candidates", () => {
    const access = estimatedAccess({ name: "A", lat: stops[0].lat, lon: stops[0].lon }, stops, 2000, 2);
    expect(access).toHaveLength(2);
    expect(access[0].stop).toBe(0);
  });
});
