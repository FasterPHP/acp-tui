// CIEDE2000 against Sharma, Wu and Dalal's published test pairs (their table 1, pair numbers as there).
import { describe, expect, test } from "bun:test";
import { ciede2000, deltaE2000, toLab, type Lab } from "./colour-difference.ts";
import { lightness, parseHex } from "./derive.ts";

const PAIRS: [number, Lab, Lab, number][] = [
  [1, [50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [2, [50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
  [3, [50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
  [4, [50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
  [7, [50, 0, 0], [50, -1, 2], 2.3669],
  [8, [50, -1, 2], [50, 0, 0], 2.3669],
  [9, [50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
  [13, [50, 2.5, 0], [73, 25, -18], 27.1492],
  [14, [50, 2.5, 0], [61, -5, 29], 22.8977],
  [15, [50, 2.5, 0], [56, -27, -3], 31.903],
  [16, [50, 2.5, 0], [58, 24, 15], 19.4535],
  [17, [50, 2.5, 0], [50, 3.1736, 0.5854], 1.0],
  [21, [60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [22, [63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
  [24, [35.0831, -44.1164, 3.7933], [35.0232, -40.0716, 1.5901], 1.8645],
  [26, [36.4612, 47.858, 18.3852], [36.2715, 50.5065, 21.2231], 1.4146],
  [29, [6.7747, -0.2908, -2.4247], [5.8714, -0.0985, -2.2286], 0.6377],
  [25, [22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
  [27, [90.8027, -2.0831, 1.441], [91.1528, -1.6435, 0.0447], 1.4441],
  [28, [90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
];

describe("CIEDE2000", () => {
  for (const [n, a, b, expected] of PAIRS) {
    test(`Sharma et al. pair ${n}: ${expected}`, () => {
      expect(ciede2000(a, b)).toBeCloseTo(expected, 4);
    });
  }

  test("identical colours differ by 0, and the difference is symmetric", () => {
    expect(deltaE2000(parseHex("#336699"), parseHex("#336699"))).toBe(0);
    const a = parseHex("#fdf6e3");
    const b = parseHex("#eee8d5");
    expect(deltaE2000(a, b)).toBeCloseTo(deltaE2000(b, a), 10);
  });

  test("toLab agrees with lightness on L* (to rounding in its luminance weights) and puts white at (100, 0, 0)", () => {
    for (const hex of ["#000000", "#191a1c", "#fdf6e3", "#e0a030", "#ffffff"]) {
      expect(toLab(parseHex(hex))[0]).toBeCloseTo(lightness(parseHex(hex)), 2);
    }
    const [L, a, b] = toLab([255, 255, 255]);
    expect(L).toBeCloseTo(100, 2);
    expect(Math.abs(a)).toBeLessThan(0.01);
    expect(Math.abs(b)).toBeLessThan(0.01);
  });
});
