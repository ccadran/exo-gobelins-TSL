import { Color, type Node } from "three/webgpu";
import { abs, cos, dot, fract, length, max, min, sin, uniform, vec2 } from "three/tsl";

export type Vec2 = Node<"vec2">;
export type Vec3 = Node<"vec3">;
export type Float = Node<"float"> | number;

export const colorUniform = (hex: string) =>
  uniform(new Color(hex)) as unknown as Vec3 & { value: Color };

export const hash21 = (p: Vec2) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));

export const hash22 = (p: Vec2) =>
  fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))).mul(43758.5453));

export const sdRoundedBox = (p: Vec2, halfSize: Vec2, radius: Float) => {
  const q = abs(p).sub(halfSize).add(radius);
  return length(max(q, 0)).add(min(max(q.x, q.y), 0)).sub(radius);
};

export const rotate2d = (p: Vec2, angle: Float) => {
  const c = cos(angle);
  const s = sin(angle);
  return vec2(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c)));
};
