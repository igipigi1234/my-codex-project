import { describe, expect, it } from "vitest";
import { decodePolyline, modeLabel, selectedTransitModes, sloveniaDateTime } from "./transitous";

describe("national transit helpers", () => {
  it("uses the Ljubljana summer and winter UTC offsets", () => {
    expect(sloveniaDateTime("2026-07-21", "08:00")).toBe("2026-07-21T08:00:00+02:00");
    expect(sloveniaDateTime("2026-01-21", "08:00")).toBe("2026-01-21T08:00:00+01:00");
  });

  it("builds a multimodal list from the selected groups", () => {
    const values = selectedTransitModes({ bus: true, train: true, other: false, wheelchair: false, bikeOnBoard: false });
    expect(values).toContain("BUS");
    expect(values).toContain("REGIONAL_RAIL");
    expect(values).not.toContain("FERRY");
  });

  it("decodes an encoded route geometry", () => {
    expect(decodePolyline({ points: "_p~iF~ps|U_ulLnnqC_mqNvxq`@", precision: 5, length: 3 }))
      .toEqual([[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
  });

  it("labels key public transport modes in Slovenian", () => {
    expect(modeLabel("BUS")).toBe("Avtobus");
    expect(modeLabel("REGIONAL_RAIL")).toBe("Vlak");
    expect(modeLabel("FUNICULAR")).toBe("Vzpenjača");
  });
});
