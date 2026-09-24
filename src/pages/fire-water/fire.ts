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
    amount: uniform(0), // 0..1, piloté par le switch (monte/descend en douceur)
    coverage: uniform(0.25), // part de la page trouée quand amount = 1
    scale: uniform(2.5), // taille des trous (plus grand = trous plus petits)
    speed: uniform(0.12), // vitesse d'ouverture / fermeture
    detail: uniform(0.3), // irrégularité des bords
    edgeWidth: uniform(0.04), // largeur du liseré incandescent
    charWidth: uniform(0.3), // largeur de la zone roussie autour des trous
    glowWidth: uniform(0.05), // portée du halo
    glowIntensity: uniform(4.5),
    // Brûlures au clic : le trou part de zéro et grandit jusqu'à burnRadius.
    ignite: uniform(0.5), // à quel point une brûlure ouvre la page
    burnRadius: uniform(0.15), // rayon final (en hauteur d'écran)
    burnGrow: uniform(1.5), // secondes pour atteindre le rayon final
    burnHold: uniform(4), // secondes à taille maximale
    burnFade: uniform(3), // secondes pour se refermer
    // Déformation de la page autour des trous
    warp: uniform(0.015), // le papier est tiré vers le trou (négatif = repoussé)
    warpWidth: uniform(0.12), // distance au bord sur laquelle la page se déforme
    shimmer: uniform(0.004), // tremblement de chaleur
    shimmerScale: uniform(18),
    shimmerSpeed: uniform(3),
    glowColor: colorUniform("#ff5a00"),
    emberColor: colorUniform("#ffd27a"),
    charColor: colorUniform("#2a1406"),
    holeColor: colorUniform("#050302"),
  };
}

export type FireParams = ReturnType<typeof createFireParams>;

// Champ de brûlure : > 0 = papier intact, < 0 = trou. La valeur sert de pseudo-distance au bord.
// Un bruit fractal 3D (x, y, temps) : en avançant dans le temps, des zones passent
// sous/au-dessus du seuil, donc des trous s'ouvrent et se referment. Le bruit fin rend
// les bords irréguliers. `heat` (0..1, brûlures au clic) fait monter le champ : le feu prend
// là où on a cliqué. Actif seulement quand le feu est allumé (× amount).
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
  // amount = 0 : seuil hors d'atteinte, aucun trou.
  const threshold = mix(1.5, oneMinus(params.coverage), params.amount);
  return threshold.sub(field);
}

export const MAX_BURNS = 8;

// Brûlures : (x, y) en screenUV, z = instant du clic, w = force. z très négatif = libre.
export function createBurns() {
  return uniformArray(
    Array.from({ length: MAX_BURNS }, () => new Vector4(0, 0, -1000, 0)),
    "vec4" as const,
  );
}

export type Burns = ReturnType<typeof createBurns>;

// Chaleur (0..1) des brûlures au point p (repère aspect). Chaque brûlure grandit de 0 à
// burnRadius, reste, puis se referme. Le contour est irrégulier car cette chaleur s'ajoute
// au bruit du champ de brûlure.
export function burnsHeat(
  p: Vec2,
  aspect: Float,
  time: Node<"float">,
  burns: Burns,
  params: FireParams,
) {
  let heat: Node<"float"> = float(0);

  // Boucle déroulée côté JS : MAX_BURNS copies dans le shader.
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

// Déplacement d'UV (repère aspect) à appliquer AVANT de lire le HTML : près des bords qui
// brûlent, le papier est tiré vers le trou et ondule sous la chaleur.
// `field(offset)` renvoie le champ de brûlure décalé de `offset` : on en tire la pente
// (différences finies), qui pointe du trou vers le papier.
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

  // Lire plus loin dans le papier = le contenu se tasse vers le bord du trou.
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

  // Papier : roussi près des trous, liseré incandescent (jaune au bord, orange après), halo.
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

  // Trou : sombre, avec les braises du bord qui éclairent un peu l'intérieur.
  const inside = params.holeColor.add(
    params.glowColor
      .mul(exp(d.div(params.glowWidth)))
      .mul(0.6)
      .mul(flicker),
  );

  return mix(paper, inside, hole);
}
