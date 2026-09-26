import type { Node } from "three/webgpu";
import {
  abs,
  exp,
  floor,
  max,
  mix,
  mx_fractal_noise_float,
  oneMinus,
  smoothstep,
  step,
  uniform,
  vec3,
} from "three/tsl";
import { colorUniform, hash21, type Vec2, type Vec3 } from "../../tsl/utils";

type Float = Node<"float">;

export function createSwitchParams() {
  return {
    frostLook: uniform(0),
    frostBlur: uniform(0.004),
    fog: uniform(0.5),
    rim: uniform(0.7),
    frostColor: colorUniform("#dcefff"),
  };
}

export type SwitchParams = ReturnType<typeof createSwitchParams>;

const insideOf = (d: Float) => oneMinus(smoothstep(-1, 1, d));

export function applySwitchFrost(
  color: Vec3,
  blurred: Vec3,
  d: Float,
  pixel: Vec2,
  time: Float,
  params: SwitchParams,
) {
  const inside = insideOf(d);
  const fog = mx_fractal_noise_float(vec3(pixel.mul(0.015), time.mul(0.05)), 3, 2, 0.5, 1)
    .mul(0.5)
    .add(0.5);
  const specks = step(0.97, hash21(floor(pixel.div(3)))).mul(0.35);
  const frosted = mix(blurred, params.frostColor, fog.mul(params.fog)).add(specks);

  const rim = exp(abs(d).div(1.5).negate()).mul(params.rim);
  const halo = exp(max(d, 0).div(12).negate()).mul(oneMinus(inside)).mul(0.25);

  return mix(color, frosted, inside.mul(params.frostLook)).add(
    params.frostColor.mul(rim.add(halo)).mul(params.frostLook),
  );
}
