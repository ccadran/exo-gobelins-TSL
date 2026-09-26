import { Vector4, type Node } from "three/webgpu";
import {
  exp,
  float,
  length,
  max,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  oneMinus,
  smoothstep,
  step,
  uniform,
  uniformArray,
  vec2,
  vec3,
} from "three/tsl";
import {
  colorUniform,
  type Float,
  type Vec2,
  type Vec3,
} from "../../tsl/utils";

export function createFireParams() {
  return {
    amount: uniform(0),
    coverage: uniform(0.25),
    scale: uniform(2.5),
    speed: uniform(0.12),
    detail: uniform(0.3),
    edgeWidth: uniform(0.04),
    charWidth: uniform(0.3),
    glowWidth: uniform(0.05),
    glowIntensity: uniform(4.5),
    ignite: uniform(0.5),
    burnRadius: uniform(0.15),
    burnGrow: uniform(1.5),
    burnHold: uniform(4),
    burnFade: uniform(3),
    warp: uniform(0.015),
    warpWidth: uniform(0.12),
    shimmer: uniform(0.004),
    shimmerScale: uniform(18),
    shimmerSpeed: uniform(3),
    glowColor: colorUniform("#ff5a00"),
    emberColor: colorUniform("#ffd27a"),
    charColor: colorUniform("#2a1406"),
    holeColor: colorUniform("#050302"),
  };
}

export type FireParams = ReturnType<typeof createFireParams>;

export function burnField(
  p: Vec2,
  time: Node<"float">,
  params: FireParams,
  heat: Float,
) {
  const large = mx_fractal_noise_float(
    vec3(p.mul(params.scale), time.mul(params.speed)),
    4,
    2,
    0.5,
    1,
  )
    .mul(0.5)
    .add(0.5);
  const fine = mx_noise_float(
    vec3(p.mul(params.scale.mul(7)), time.mul(params.speed.mul(3))),
  );
  const field = large
    .add(fine.mul(params.detail))
    .add(params.ignite.mul(heat).mul(params.amount));
  const threshold = mix(1.5, oneMinus(params.coverage), params.amount);
  return threshold.sub(field);
}

export const MAX_BURNS = 8;

export function createBurns() {
  return uniformArray(
    Array.from({ length: MAX_BURNS }, () => new Vector4(0, 0, -1000, 0)),
    "vec4" as const,
  );
}

export type Burns = ReturnType<typeof createBurns>;

export function burnsHeat(
  p: Vec2,
  aspect: Float,
  time: Node<"float">,
  burns: Burns,
  params: FireParams,
) {
  let heat: Node<"float"> = float(0);

  for (let i = 0; i < MAX_BURNS; i++) {
    const burn = burns.element(i);
    const age = time.sub(burn.z);
    const grow = smoothstep(0, params.burnGrow, age);
    const closeStart = params.burnGrow.add(params.burnHold);
    const fade = oneMinus(
      smoothstep(closeStart, closeStart.add(params.burnFade), age),
    );
    const radius = max(params.burnRadius.mul(grow), 0.0001);
    const distance = length(p.sub(vec2(burn.x.mul(aspect), burn.y)));
    const h = oneMinus(smoothstep(0, radius, distance))
      .mul(fade)
      .mul(step(0, age))
      .mul(burn.w);
    heat = max(heat, h);
  }

  return heat;
}

export function burnDistortion(
  p: Vec2,
  d: Node<"float">,
  field: (offset: Vec2) => Node<"float">,
  time: Node<"float">,
  params: FireParams,
) {
  const eps = 0.004;
  const gradient = vec2(
    field(vec2(eps, 0)).sub(d),
    field(vec2(0, eps)).sub(d),
  );
  const direction = gradient.div(max(length(gradient), 0.000001));
  const near = exp(max(d, 0).div(params.warpWidth).negate()).mul(
    params.amount,
  );

  const pull = direction.mul(params.warp);
  const q = vec3(p.mul(params.shimmerScale), time.mul(params.shimmerSpeed));
  const shimmer = vec2(
    mx_noise_float(q),
    mx_noise_float(q.add(vec3(17.3, 5.1, 0))),
  ).mul(params.shimmer);

  return pull.add(shimmer).mul(near);
}

export function applyFire(
  color: Vec3,
  d: Node<"float">,
  p: Vec2,
  time: Node<"float">,
  params: FireParams,
) {
  const onPaper = max(d, 0);
  const hole = oneMinus(smoothstep(-0.003, 0, d));
  const edge = oneMinus(smoothstep(0, params.edgeWidth, onPaper));
  const char = oneMinus(smoothstep(0, params.charWidth, onPaper));
  const flicker = mx_noise_float(vec3(p.mul(8), time.mul(6)))
    .mul(0.3)
    .add(0.85);

  const charred = mix(color, params.charColor, char.mul(char));
  const emission = mix(params.glowColor, params.emberColor, edge.mul(edge))
    .mul(edge)
    .mul(params.glowIntensity)
    .mul(flicker);
  const halo = params.glowColor
    .mul(exp(onPaper.div(params.glowWidth).negate()))
    .mul(params.glowIntensity.mul(0.35))
    .mul(flicker);
  const paper = charred.add(emission).add(halo);

  const inside = params.holeColor.add(
    params.glowColor
      .mul(exp(d.div(params.glowWidth)))
      .mul(0.6)
      .mul(flicker),
  );

  return mix(paper, inside, hole);
}
