import { describe, expect, it } from "vitest";
import { fmt, parseSiteTime } from "../src/time";

describe("Chicago time, same as Python on the Mac", () => {
  it("formats like strftime('%a %b %d, %I:%M %p')", () => {
    expect(fmt(1793514600)).toBe("Sun Nov 01, 01:30 AM"); // first 1:30, CDT
    expect(fmt(1793518200)).toBe("Sun Nov 01, 01:30 AM"); // second 1:30, CST
    expect(fmt(1793649600)).toBe("Mon Nov 02, 02:00 PM");
    expect(fmt(1792557000)).toBe("Tue Oct 20, 11:30 PM");
    expect(fmt(1796112300)).toBe("Tue Dec 01, 02:05 AM");
    expect(fmt(1796105100)).toBe("Tue Dec 01, 12:05 AM");
    expect(fmt(1789000000)).toBe("Wed Sep 09, 07:26 PM"); // "Sep", not ICU's "Sept"
    expect(fmt(null)).toBe("n/a");
    expect(fmt(0)).toBe("n/a");
  });
  it("parses the Results page expiry", () => {
    const cases: [string, number | null][] = [
      ["10/21/2026 11:30:00 PM", 1792643400],
      ["11/01/2026 01:30:00 AM", 1793514600], // repeated hour: the first one, like Python fold=0
      ["11/01/2026 02:30:00 AM", 1793521800],
      ["03/08/2026 02:30:00 AM", 1772958600], // skipped hour: offset from before the change
      ["03/08/2026 03:30:00 AM", 1772958600],
      ["12/01/2026 12:05:00 AM", 1796105100],
      ["1/2/2027 1:02:03 PM", 1798916523],
      ["13/01/2026 01:00:00 AM", null],
      ["02/30/2026 01:00:00 AM", null],
      ["10/21/2026 13:30:00 PM", null],
      ["garbage", null],
    ];
    for (const [s, want] of cases) expect(parseSiteTime(s), s).toBe(want);
  });
});
