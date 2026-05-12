/**
 * Phase F · Iter 07 MVP — Unit tests for sharp text overlay.
 *
 * Focuses on SVG generation (deterministic, no sharp call) plus one
 * end-to-end smoke test on a synthetic 200x200 buffer.
 */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  composeTextOverlay,
  __buildSvgOverlay_forTest,
} from "../../src/lib/sharp-text-overlay.js";

describe("buildSvgOverlay", () => {
  it("emits a single <text> for one block", () => {
    const svg = __buildSvgOverlay_forTest(1000, 1000, [
      { text: "Hello", anchorX: 0.1, anchorY: 0.5, fontSize: 48 },
    ]);
    expect(svg).toMatch(/<text /);
    expect(svg).toMatch(/x="100"/);
    expect(svg).toMatch(/y="500"/);
    expect(svg).toMatch(/font-size="48"/);
    expect(svg).toMatch(/font-weight="600"/);
    expect(svg).toMatch(/fill="#000000"/);
    expect(svg).toMatch(/Hello<\/text>/);
  });

  it("escapes XML-special characters", () => {
    const svg = __buildSvgOverlay_forTest(500, 500, [
      { text: 'AT&T "Quality" <Premium>', anchorX: 0, anchorY: 0, fontSize: 24 },
    ]);
    expect(svg).toMatch(/AT&amp;T &quot;Quality&quot; &lt;Premium&gt;/);
    expect(svg).not.toMatch(/AT&T/);
  });

  it("renders multi-block overlay (one <text> per block)", () => {
    const svg = __buildSvgOverlay_forTest(800, 600, [
      { text: "Top", anchorX: 0.5, anchorY: 0.1, fontSize: 32, align: "center" },
      { text: "Bottom", anchorX: 0.5, anchorY: 0.9, fontSize: 24, align: "center" },
    ]);
    const matches = svg.match(/<text /g);
    expect(matches?.length).toBe(2);
    expect(svg).toMatch(/text-anchor="middle"/);
  });

  it("supports right-align (text-anchor=end)", () => {
    const svg = __buildSvgOverlay_forTest(1000, 1000, [
      { text: "Right", anchorX: 0.9, anchorY: 0.5, fontSize: 32, align: "right" },
    ]);
    expect(svg).toMatch(/text-anchor="end"/);
  });

  it("wraps text with <tspan> when maxWidth is set", () => {
    const svg = __buildSvgOverlay_forTest(800, 600, [
      {
        text: "Long line of text that should wrap onto multiple visual rows",
        anchorX: 0.1,
        anchorY: 0.5,
        fontSize: 32,
        maxWidth: 200,
      },
    ]);
    const tspans = svg.match(/<tspan /g);
    expect(tspans?.length ?? 0).toBeGreaterThan(1);
  });

  it("inserts <filter> when shadow is set", () => {
    const svg = __buildSvgOverlay_forTest(500, 500, [
      {
        text: "Shadow",
        anchorX: 0.5,
        anchorY: 0.5,
        fontSize: 32,
        shadow: "rgba(0,0,0,0.5)",
      },
    ]);
    expect(svg).toMatch(/<filter /);
    expect(svg).toMatch(/feDropShadow/);
    expect(svg).toMatch(/filter="url\(#s/);
  });

  it("uses web-safe font stack with CJK fallback", () => {
    const svg = __buildSvgOverlay_forTest(500, 500, [
      { text: "中文", anchorX: 0.5, anchorY: 0.5, fontSize: 32 },
    ]);
    expect(svg).toMatch(/PingFang SC/);
    expect(svg).toMatch(/Microsoft YaHei/);
  });
});

describe("composeTextOverlay", () => {
  it("composites text onto a synthetic white base", async () => {
    // Build a 200x200 solid white buffer
    const base = await sharp({
      create: { width: 200, height: 200, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();

    const out = await composeTextOverlay({
      baseBuffer: base,
      blocks: [
        { text: "TEST", anchorX: 0.5, anchorY: 0.5, fontSize: 32, align: "center" },
      ],
    });

    expect(out.length).toBeGreaterThan(0);
    // Verify the output is a valid PNG sharp can read back.
    const outMeta = await sharp(out).metadata();
    expect(outMeta.width).toBe(200);
    expect(outMeta.height).toBe(200);
    expect(outMeta.format).toBe("png");
  });

  it("throws on zero-dimension input", async () => {
    // Sharp can't process an empty buffer; expect a throw.
    await expect(
      composeTextOverlay({
        baseBuffer: Buffer.from(""),
        blocks: [{ text: "x", anchorX: 0, anchorY: 0, fontSize: 24 }],
      })
    ).rejects.toThrow();
  });
});
