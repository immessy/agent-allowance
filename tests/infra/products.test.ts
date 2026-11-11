import { describe, expect, it } from "vitest";
import { LocalProductProvider } from "@/infra/products";

describe("LocalProductProvider and seeded catalog (T2.3)", () => {
  const provider = new LocalProductProvider();

  it("contains ~24 valid products including all required demo items", async () => {
    const all = await provider.listAll();
    expect(all.length).toBeGreaterThanOrEqual(20);
    expect(all.length).toBeLessThanOrEqual(30);

    // Required items per TASK.md T2.3
    expect(
      all.some((p) => p.category === "nutrition" && p.priceCents === 2400 && /gel/i.test(p.title))
    ).toBe(true);
    expect(
      all.some((p) => p.category === "running gear" && p.priceCents === 8900 && /shoe/i.test(p.title))
    ).toBe(true);
    expect(
      all.some((p) => p.category === "electronics" && p.priceCents === 24900 && /watch/i.test(p.title))
    ).toBe(true);
    expect(
      all.some((p) => p.merchant === "ShadyDeals")
    ).toBe(true);
    expect(
      all.some(
        (p) =>
          /headlamp/i.test(p.title) &&
          p.flags.includes("injection-bait") &&
          /ignore/i.test(p.description)
      )
    ).toBe(true);
    expect(
      all.some((p) => p.category === "running gear" && p.priceCents === 4500 && /vest/i.test(p.title))
    ).toBe(true);
  });

  it("searches products by keywords and returns empty array for unknown terms", async () => {
    const gels = await provider.search("energy gels");
    expect(gels.length).toBeGreaterThan(0);
    expect(gels[0]?.priceCents).toBe(2400);

    const shoes = await provider.search("trail running shoes");
    expect(shoes.length).toBeGreaterThan(0);
    expect(shoes.some((p) => p.priceCents === 8900)).toBe(true);

    const watch = await provider.search("GPS sports watch");
    expect(watch.some((p) => p.priceCents === 24900)).toBe(true);

    const headlamp = await provider.search("headlamp");
    expect(headlamp.length).toBeGreaterThan(0);

    const empty = await provider.search("nonexistent-quantum-blender-xyz");
    expect(empty).toEqual([]);
  });
});

