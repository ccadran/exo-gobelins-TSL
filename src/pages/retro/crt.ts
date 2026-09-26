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

export function createRetroParams() {
  return {
    time: uniform(0),
    curve: uniform(0.15),
    vignette: uniform(0.9),
    linePeriod: uniform(4),
    scanDarkness: uniform(0.55),
    maskStrength: uniform(0.35),
    rollSpeed: uniform(0.35),
    rollCount: uniform(3),
    rollStrength: uniform(0.08),
    chroma: uniform(0.05),
    bloomStrength: uniform(0),
    bloomMax: 0.8,
    bloomRadius: uniform(0.6),
    bloomThreshold: uniform(0.6),
    grain: uniform(0.14),
    flicker: uniform(0.017),
    interlaceDarkness: uniform(0.35),
    tearChance: uniform(0.04),
    tearOffset: uniform(0.05),
  };
}

export type RetroParams = ReturnType<typeof createRetroParams>;

export function barrel(uv: Vec2, amount: Float) {
  const p = uv.mul(2).sub(1);
  const squared = p.mul(p);
  const bent = p.mul(oneMinus(amount.mul(oneMinus(squared.yx))));
  return bent.mul(0.5).add(0.5);
}

function insideScreen(uv: Vec2) {
  const edge = 0.002;
  return smoothstep(0, edge, uv.x)
    .mul(smoothstep(0, edge, uv.y))
    .mul(oneMinus(smoothstep(1 - edge, 1, uv.x)))
    .mul(oneMinus(smoothstep(1 - edge, 1, uv.y)));
}

export function crtImage(
  page: Texture,
  effects: RetroEffects,
  params: RetroParams,
) {
  let uv = barrel(
    screenUV as unknown as Vec2,
    params.curve.mul(effects.curve.value),
  );

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

  const offset = uv.sub(0.5).mul(params.chroma).mul(effects.chroma.value);
  const r = texture(page, uv.add(offset)).r;
  const g = texture(page, uv).g;
  const b = texture(page, uv.sub(offset)).b;
  let color: Vec3 = vec3(r, g, b);

  const field = mod(floor(params.time.mul(60)), 2);
  const darkLine = select(mod(line, 2).equal(field), float(1), float(0));
  color = color.mul(
    oneMinus(
      darkLine.mul(params.interlaceDarkness).mul(effects.interlace.value),
    ),
  );

  return color.mul(insideScreen(uv));
}

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

  const wave = cos(
    uv.y
      .mul(screenSize.y)
      .div(params.linePeriod)
      .mul(Math.PI * 2),
  )
    .mul(0.5)
    .add(0.5);
  color = color.mul(mix(1, mix(oneMinus(params.scanDarkness), 1, wave), scan));

  const column = mod(floor(screenUV.x.mul(screenSize.x)), 3);
  const dim = oneMinus(params.maskStrength);
  const mask = vec3(
    select(column.equal(0), float(1), dim),
    select(column.equal(1), float(1), dim),
    select(column.equal(2), float(1), dim),
  );
  color = color.mul(mix(vec3(1, 1, 1), mask, scan));

  const rollPhase = mod(
    uv.y.sub(params.time.mul(params.rollSpeed)).mul(params.rollCount),
    1,
  );
  const roll = smoothstep(0, 0.15, oneMinus(rollPhase));
  color = color.mul(float(1).add(roll.mul(params.rollStrength).mul(scan)));

  const frame = floor(params.time.mul(60));
  const grain = hash21(
    screenUV.mul(screenSize).add(vec2(frame.mul(13.1), frame.mul(7.7))),
  ).sub(0.5);
  const flicker = hash21(vec2(frame, 1.7)).sub(0.5).mul(params.flicker);
  color = color
    .mul(float(1).add(flicker.mul(effects.noise.value)))
    .add(grain.mul(params.grain).mul(effects.noise.value));

  const vignette = pow(
    uv.x.mul(oneMinus(uv.x)).mul(uv.y).mul(oneMinus(uv.y)).mul(16).clamp(0, 1),
    params.vignette.mul(effects.curve.value),
  );
  color = color.mul(vignette);

  return color.mul(insideScreen(uv));
}
