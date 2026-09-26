import { BufferGeometry, Float32BufferAttribute } from "three/webgpu";
import type { P2 } from "./voronoi";

export type ShardGeometryOptions = {
  poly: P2[];
  center: P2;
  halfWidth: number;
  halfHeight: number;
  depth: number;
  grow: number;
  crackOrder: number;
};

export function createShardGeometry(options: ShardGeometryOptions) {
  const { poly, center, halfWidth, halfHeight, depth, grow, crackOrder } = options;
  const [cx, cy] = center;
  const half = depth / 2;

  const expanded = poly.map(([x, y]): P2 => {
    const dx = x - cx;
    const dy = y - cy;
    const length = Math.hypot(dx, dy) || 1;
    return [x + (dx / length) * grow, y + (dy / length) * grow];
  });

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const edges: number[] = [];

  const push = (x: number, y: number, z: number, n: [number, number, number], edge: number) => {
    positions.push(x - cx, y - cy, z);
    normals.push(...n);
    uvs.push((x + halfWidth) / (2 * halfWidth), (halfHeight - y) / (2 * halfHeight));
    edges.push(edge);
  };

  const count = expanded.length;
  for (let i = 0; i < count; i++) {
    const [ax, ay] = expanded[i];
    const [bx, by] = expanded[(i + 1) % count];

    push(cx, cy, half, [0, 0, 1], 1);
    push(ax, ay, half, [0, 0, 1], 0);
    push(bx, by, half, [0, 0, 1], 0);

    push(cx, cy, -half, [0, 0, -1], 1);
    push(bx, by, -half, [0, 0, -1], 0);
    push(ax, ay, -half, [0, 0, -1], 0);

    const length = Math.hypot(bx - ax, by - ay) || 1;
    const n: [number, number, number] = [(by - ay) / length, -(bx - ax) / length, 0];
    push(ax, ay, half, n, 0);
    push(ax, ay, -half, n, 0);
    push(bx, by, -half, n, 0);
    push(ax, ay, half, n, 0);
    push(bx, by, -half, n, 0);
    push(bx, by, half, n, 0);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("edge", new Float32BufferAttribute(edges, 1));
  geometry.setAttribute(
    "crackOrder",
    new Float32BufferAttribute(new Array(positions.length / 3).fill(crackOrder), 1),
  );
  return geometry;
}
