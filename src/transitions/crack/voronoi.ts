export type P2 = [number, number];

function clipHalf(poly: P2[], mx: number, my: number, nx: number, ny: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = (a[0] - mx) * nx + (a[1] - my) * ny;
    const db = (b[0] - mx) * nx + (b[1] - my) * ny;
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

export function voronoiCell(seeds: P2[], i: number, halfWidth: number, halfHeight: number): P2[] {
  const [sx, sy] = seeds[i];
  let poly: P2[] = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ];
  for (let j = 0; j < seeds.length && poly.length; j++) {
    if (j === i) continue;
    const [ox, oy] = seeds[j];
    poly = clipHalf(poly, (sx + ox) / 2, (sy + oy) / 2, sx - ox, sy - oy);
  }
  return poly;
}

export function centroid(poly: P2[]): P2 {
  let area = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    x += (x0 + x1) * cross;
    y += (y0 + y1) * cross;
  }
  if (Math.abs(area) < 1e-9) return poly[0];
  return [x / (3 * area), y / (3 * area)];
}

export type SeedOptions = {
  impact: P2;
  radial: number;
  uniform: number;
  radialSpread: number;
};

export function createSeeds(halfWidth: number, halfHeight: number, options: SeedOptions): P2[] {
  const seeds: P2[] = [];
  const inside = (x: number, y: number) => Math.abs(x) < halfWidth && Math.abs(y) < halfHeight;

  for (let i = 0; i < options.radial; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = options.radialSpread * Math.random() ** 2;
    const x = options.impact[0] + Math.cos(angle) * radius;
    const y = options.impact[1] + Math.sin(angle) * radius;
    if (inside(x, y)) seeds.push([x, y]);
  }
  for (let i = 0; i < options.uniform; i++) {
    seeds.push([
      (Math.random() * 2 - 1) * halfWidth * 0.98,
      (Math.random() * 2 - 1) * halfHeight * 0.98,
    ]);
  }
  return seeds;
}
