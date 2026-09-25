import { BufferGeometry, Float32BufferAttribute } from "three/webgpu";
import type { P2 } from "./voronoi";

export type ShardGeometryOptions = {
  poly: P2[]; // cellule, sens trigonométrique, repère monde
  center: P2; // centre de l'éclat (les sommets sont exprimés par rapport à lui)
  halfWidth: number;
  halfHeight: number;
  depth: number; // épaisseur du verre
  grow: number; // léger débord pour que les éclats voisins se chevauchent (pas de fente)
  crackOrder: number; // plus c'est petit, plus l'éclat se fissure tôt
};

// Éclat extrudé : face avant (z+), face arrière (z-) et tranches.
// Attributs :
// - uv : position d'origine du sommet dans la page (repère screenUV, origine en haut à gauche),
//   pour que l'éclat affiche exactement le morceau de page qu'il recouvrait ;
// - edge : 1 au centre, 0 sur le bord (faces avant/arrière en éventail depuis le centre).
//   Sert à dessiner la ligne de fissure à épaisseur constante (via fwidth) ;
// - crackOrder : ordre de fissure de l'éclat, identique sur tout l'éclat.
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

    // Face avant : triangle (centre, a, b), sens trigo vu de +z.
    push(cx, cy, half, [0, 0, 1], 1);
    push(ax, ay, half, [0, 0, 1], 0);
    push(bx, by, half, [0, 0, 1], 0);

    // Face arrière : même triangle, sens inversé.
    push(cx, cy, -half, [0, 0, -1], 1);
    push(bx, by, -half, [0, 0, -1], 0);
    push(ax, ay, -half, [0, 0, -1], 0);

    // Tranche : normale sortante, perpendiculaire à l'arête a -> b.
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
