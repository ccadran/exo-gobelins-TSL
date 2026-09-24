import { Vector4, type Node } from "three/webgpu";
import {
  abs,
  exp,
  float,
  floor,
  fract,
  length,
  max,
  mix,
  oneMinus,
  sin,
  smoothstep,
  step,
  uniform,
  uniformArray,
  vec2,
} from "three/tsl";
import {
  colorUniform,
  hash21,
  hash22,
  rotate2d,
  type Vec2,
} from "../../tsl/utils";

type Float = Node<"float">;

export const MAX_RIPPLES = 12;

export function createRainParams() {
  return {
    amount: uniform(0), // 0..1, intensité de la pluie (switch)
    wetness: uniform(0), // 0..1, la page se mouille progressivement
    // Traits de pluie
    angle: uniform(1.6), // 0 = horizontale, en radians
    density: uniform(55), // nombre de rangées sur la hauteur
    speed: uniform(6),
    streakLength: uniform(0.35), // longueur d'un trait (fraction de son cycle)
    streakOpacity: uniform(0.25),
    // Ripples (impacts sur la page)
    rippleSpeed: uniform(0.22),
    rippleWidth: uniform(0.012),
    rippleStrength: uniform(0.035),
    rippleLife: uniform(1.4),
    // Page mouillée
    dropScale: uniform(16), // gouttes statiques par unité de hauteur
    dropLens: uniform(0.7), // force de la réfraction des gouttes
    trickleColumns: uniform(16), // colonnes de gouttes qui coulent
    trickleSpeed: uniform(0.07),
    wetTint: colorUniform("#8fa9bd"),
  };
}

export type RainParams = ReturnType<typeof createRainParams>;

// Impacts : (x, y) en screenUV, z = instant de l'impact, w = force. z très négatif = libre.
export function createImpacts() {
  return uniformArray(
    Array.from({ length: MAX_RIPPLES }, () => new Vector4(0, 0, -1000, 0)),
    "vec4" as const,
  );
}

export type Impacts = ReturnType<typeof createImpacts>;

// Traits de pluie devant la page, qui avancent dans la direction `angle`.
// Deux couches (proche / lointaine) pour la profondeur.
export function rainStreaks(
  uv: Vec2,
  aspect: Float,
  time: Float,
  params: RainParams,
) {
  const q = rotate2d(vec2(uv.x.mul(aspect), uv.y), params.angle.negate());

  const layer = (scale: number, seed: number, speedFactor: number) => {
    const rowCoord = q.y.mul(params.density.mul(scale));
    const row = floor(rowCoord);
    const random = hash21(vec2(row, seed));
    const random2 = hash21(vec2(row, seed + 13.7));
    const thin = oneMinus(smoothstep(0, 0.08, abs(fract(rowCoord).sub(0.5))));
    const along = q.x
      .mul(params.density.mul(scale * 0.08))
      .sub(
        time.mul(params.speed).mul(speedFactor).mul(random.mul(0.6).add(0.7)),
      )
      .add(random2.mul(10));
    const segment = fract(along);
    // Queue qui s'estompe (segment 0 -> length), tête nette à l'avant.
    const streak = smoothstep(0, params.streakLength, segment).mul(
      oneMinus(
        smoothstep(params.streakLength, params.streakLength.add(0.01), segment),
      ),
    );
    const visible = step(0.55, random2);
    return streak.mul(thin).mul(visible);
  };

  return layer(1, 1, 1)
    .add(layer(0.6, 31, 0.7).mul(0.5))
    .mul(params.streakOpacity)
    .mul(params.amount);
}

// Somme des ondes circulaires de tous les impacts actifs.
// offset : déplacement d'UV (réfraction), light : reflet sur les crêtes.
export function ripples(
  uv: Vec2,
  aspect: Float,
  time: Float,
  impacts: Impacts,
  params: RainParams,
) {
  const toAspect = vec2(aspect, 1);
  let offset: Vec2 = vec2(0, 0);
  let light: Float = float(0);

  // Boucle déroulée côté JS : MAX_RIPPLES copies dans le shader.
  for (let i = 0; i < MAX_RIPPLES; i++) {
    const impact = impacts.element(i);
    const age = time.sub(impact.z);
    const life = oneMinus(smoothstep(0, params.rippleLife, age)).mul(
      step(0, age),
    );
    const delta = uv.sub(impact.xy).mul(toAspect);
    const distance = length(delta);
    const x = distance.sub(age.mul(params.rippleSpeed)).div(params.rippleWidth);
    const ring = exp(x.mul(x).negate()).mul(life).mul(impact.w);
    const wave = sin(x.mul(2.5)).mul(ring);
    offset = offset.add(delta.div(max(distance, 0.0001)).mul(wave));
    light = light.add(ring.mul(max(wave, 0)));
  }

  return { offset: offset.mul(params.rippleStrength).div(toAspect), light };
}

// Page mouillée : gouttes statiques (apparaissent avec la wetness) + gouttes qui coulent
// vers le bas en laissant une traînée. Chaque goutte agit comme une petite lentille.
export function wetGlass(
  uv: Vec2,
  aspect: Float,
  time: Float,
  params: RainParams,
) {
  // Gouttes statiques : une par cellule de grille, position/taille aléatoires.
  const st = vec2(uv.x.mul(aspect), uv.y).mul(params.dropScale);
  const cell = floor(st);
  const local = fract(st).sub(0.5).sub(hash22(cell).sub(0.5).mul(0.6));
  const exists = step(hash21(cell.add(3.1)), params.wetness);
  const size = mix(0.08, 0.3, hash21(cell.add(5.7)).pow(2));
  const drop = oneMinus(smoothstep(size.mul(0.75), size, length(local))).mul(
    exists,
  );
  const staticOffset = local.mul(drop).div(params.dropScale);

  // Gouttes qui coulent : une par colonne active, repère isotrope en "unités de colonne".
  const tc = vec2(uv.x.mul(aspect), uv.y).mul(params.trickleColumns);
  const column = floor(tc.x);
  const random = hash21(vec2(column, 2.3));
  const random2 = hash21(vec2(column, 9.1));
  const active = step(random, params.wetness.mul(0.7));
  const headY = fract(
    time
      .mul(params.trickleSpeed)
      .mul(random2.mul(0.8).add(0.6))
      .add(random.mul(7)),
  )
    .mul(1.3)
    .sub(0.15)
    .mul(params.trickleColumns);
  const wiggle = sin(tc.y.mul(1.7).add(random.mul(40)))
    .mul(0.15)
    .add(sin(tc.y.mul(4.1).add(random2.mul(20))).mul(0.06));
  const dx = fract(tc.x).sub(0.5).sub(wiggle).sub(random2.sub(0.5).mul(0.4));
  const dy = tc.y.sub(headY);
  const headSize = random.mul(0.08).add(0.18);
  const head = oneMinus(
    smoothstep(headSize.mul(0.7), headSize, length(vec2(dx, dy.mul(0.75)))),
  ).mul(active);
  // Traînée au-dessus de la tête (dy < 0), qui s'estompe sur ~3 colonnes.
  const trailFade = smoothstep(-3, 0, dy).mul(step(dy, 0)).mul(active);
  const trail = oneMinus(smoothstep(0.03, 0.06, abs(dx))).mul(trailFade);
  const trailCell = fract(tc.y.mul(2.5)).sub(0.5).div(2.5);
  const trailDrops = oneMinus(
    smoothstep(0.05, 0.09, length(vec2(dx, trailCell))),
  ).mul(trailFade);
  const trickleOffset = vec2(dx, dy)
    .mul(head)
    .add(vec2(dx, 0).mul(trail.add(trailDrops)).mul(0.5))
    .div(params.trickleColumns);

  const mask = max(max(drop, head), max(trail, trailDrops));
  const offset = staticOffset
    .add(trickleOffset)
    .mul(params.dropLens)
    .div(vec2(aspect, 1));
  return { offset, mask };
}
