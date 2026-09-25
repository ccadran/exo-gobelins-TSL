import type { Node, Texture } from "three/webgpu";
import {
  cos,
  float,
  floor,
  mix,
  mod,
  oneMinus,
  pow,
  screenSize,
  screenUV,
  select,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import { hash21, type Vec2, type Vec3 } from "../../tsl/utils";

type Float = Node<"float">;

// Chaque effet a une plage [start, end] sur l'intensité globale (0 = No, 1 = Yes) :
// il apparaît à `start` et atteint `max` à `end`. `value` est l'uniform envoyé au shader,
// recalculé en JS à chaque frame.
export type RetroEffect = {
  start: number;
  end: number;
  max: number;
  value: Float & { value: number };
};

const effect = (start: number, end: number, max = 1): RetroEffect => ({
  start,
  end,
  max,
  value: uniform(0),
});

export function createRetroEffects() {
  return {
    scanlines: effect(0, 0.35),
    noise: effect(0.1, 0.55),
    chroma: effect(0.2, 0.6),
    bloom: effect(0.3, 0.7),
    curve: effect(0.4, 0.85),
    interlace: effect(0.6, 1),
  };
}

export type RetroEffects = ReturnType<typeof createRetroEffects>;

// Réglages "à fond" de chaque effet (multipliés par la valeur de l'effet).
export function createRetroParams() {
  return {
    time: uniform(0),
    // Courbure + vignettage
    curve: uniform(0.15), // bombé : courbure des lignes (0 = plat, < 1)
    vignette: uniform(0.9),
    // Scanlines + masque RGB
    linePeriod: uniform(4), // hauteur d'une ligne en pixels (drawing buffer)
    scanDarkness: uniform(0.55),
    maskStrength: uniform(0.35), // grille RGB verticale (phosphores)
    rollSpeed: uniform(0.35), // bandes lumineuses qui descendent (écrans par seconde)
    rollCount: uniform(3), // nombre de bandes à l'écran en même temps
    rollStrength: uniform(0.08),
    // Aberration chromatique
    chroma: uniform(0.05),
    // Bloom (BloomNode de three)
    bloomStrength: uniform(0), // piloté en JS : bloom.value × bloomMax
    bloomMax: 0.8,
    bloomRadius: uniform(0.6),
    bloomThreshold: uniform(0.6),
    // Bruit + scintillement
    grain: uniform(0.14),
    flicker: uniform(0.017),
    // Entrelacement
    interlaceDarkness: uniform(0.35),
    tearChance: uniform(0.04), // proportion de lignes décalées à chaque instant
    tearOffset: uniform(0.05), // décalage horizontal max de ces lignes
  };
}

export type RetroParams = ReturnType<typeof createRetroParams>;

// Courbure "écran bombé", avec p dans [-1, 1] :
//   x' = x × (1 - k·(1 - y²))   et   y' = y × (1 - k·(1 - x²))
// En haut et en bas (y = ±1) rien ne bouge ; au milieu, on lit plus près du centre. Les
// lignes droites se bombent donc vers l'extérieur, et on ne lit jamais hors de la page
// (pas de fond visible). Grossissement au centre : 1 / (1 - k). 0 = plat.
export function barrel(uv: Vec2, amount: Float) {
  const p = uv.mul(2).sub(1);
  const squared = p.mul(p);
  // Le resserrement horizontal dépend de la hauteur (et inversement) : c'est ce couplage
  // qui courbe les lignes droites.
  const bent = p.mul(oneMinus(amount.mul(oneMinus(squared.yx))));
  return bent.mul(0.5).add(0.5);
}

// 1 à l'intérieur de l'écran, 0 hors du tube (coins noirs quand l'écran est bombé).
function insideScreen(uv: Vec2) {
  const edge = 0.002;
  return smoothstep(0, edge, uv.x)
    .mul(smoothstep(0, edge, uv.y))
    .mul(oneMinus(smoothstep(1 - edge, 1, uv.x)))
    .mul(oneMinus(smoothstep(1 - edge, 1, uv.y)));
}

// Passe 1 : l'image affichée par le tube (courbure, entrelacement, aberration chromatique).
export function crtImage(
  page: Texture,
  effects: RetroEffects,
  params: RetroParams,
) {
  let uv = barrel(
    screenUV as unknown as Vec2,
    params.curve.mul(effects.curve.value),
  );

  // Entrelacement : quelques lignes, tirées au hasard, se décalent horizontalement.
  const line = floor(uv.y.mul(screenSize.y).div(params.linePeriod));
  const frame = floor(params.time.mul(30));
  const torn = step(oneMinus(params.tearChance), hash21(vec2(line, frame)));
  const tear = hash21(vec2(line.add(7.3), frame))
    .sub(0.5)
    .mul(2)
    .mul(params.tearOffset)
    .mul(torn)
    .mul(effects.interlace.value);
  uv = vec2(uv.x.add(tear), uv.y);

  // Aberration chromatique : R et B décalés dans des sens opposés, plus fort vers les bords.
  const offset = uv.sub(0.5).mul(params.chroma).mul(effects.chroma.value);
  const r = texture(page, uv.add(offset)).r;
  const g = texture(page, uv).g;
  const b = texture(page, uv.sub(offset)).b;
  let color: Vec3 = vec3(r, g, b);

  // Entrelacement : une ligne sur deux est plus sombre, et ça s'inverse à chaque frame
  // (les deux "demi-images" alternent : les lignes papillotent).
  const field = mod(floor(params.time.mul(60)), 2);
  const darkLine = select(mod(line, 2).equal(field), float(1), float(0));
  color = color.mul(
    oneMinus(
      darkLine.mul(params.interlaceDarkness).mul(effects.interlace.value),
    ),
  );

  return color.mul(insideScreen(uv));
}

// Passe 2 : ce qui se passe "sur la vitre" du tube, par-dessus l'image + son bloom.
export function crtScreen(
  image: Vec3,
  effects: RetroEffects,
  params: RetroParams,
) {
  const uv = barrel(
    screenUV as unknown as Vec2,
    params.curve.mul(effects.curve.value),
  );
  const scan = effects.scanlines.value;
  let color = image;

  // Scanlines : bandes sombres horizontales (suivent la courbure).
  const wave = cos(
    uv.y
      .mul(screenSize.y)
      .div(params.linePeriod)
      .mul(Math.PI * 2),
  )
    .mul(0.5)
    .add(0.5);
  color = color.mul(mix(1, mix(oneMinus(params.scanDarkness), 1, wave), scan));

  // Masque RGB : colonnes de phosphores rouge / vert / bleu.
  const column = mod(floor(screenUV.x.mul(screenSize.x)), 3);
  const dim = oneMinus(params.maskStrength);
  const mask = vec3(
    select(column.equal(0), float(1), dim),
    select(column.equal(1), float(1), dim),
    select(column.equal(2), float(1), dim),
  );
  color = color.mul(mix(vec3(1, 1, 1), mask, scan));

  // Balayage : bandes lumineuses qui descendent (plusieurs à la fois).
  const rollPhase = mod(
    uv.y.sub(params.time.mul(params.rollSpeed)).mul(params.rollCount),
    1,
  );
  const roll = smoothstep(0, 0.15, oneMinus(rollPhase));
  color = color.mul(float(1).add(roll.mul(params.rollStrength).mul(scan)));

  // Bruit : grain différent à chaque frame + scintillement global.
  const frame = floor(params.time.mul(60));
  const grain = hash21(
    screenUV.mul(screenSize).add(vec2(frame.mul(13.1), frame.mul(7.7))),
  ).sub(0.5);
  const flicker = hash21(vec2(frame, 1.7)).sub(0.5).mul(params.flicker);
  color = color
    .mul(float(1).add(flicker.mul(effects.noise.value)))
    .add(grain.mul(params.grain).mul(effects.noise.value));

  // Vignettage : coins plus sombres, avec la courbure.
  const vignette = pow(
    uv.x.mul(oneMinus(uv.x)).mul(uv.y).mul(oneMinus(uv.y)).mul(16).clamp(0, 1),
    params.vignette.mul(effects.curve.value),
  );
  color = color.mul(vignette);

  return color.mul(insideScreen(uv));
}
