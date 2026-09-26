import {
  DoubleSide,
  MeshBasicNodeMaterial,
  Texture,
  Vector3,
} from "three/webgpu";
import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  dot,
  fwidth,
  mix,
  normalLocal,
  normalView,
  normalWorld,
  oneMinus,
  positionView,
  positionWorld,
  pow,
  reflect,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { colorUniform, type Vec3 } from "../../tsl/utils";

type Float = Node<"float">;

export function createGlassParams() {
  return {
    crackRadius: uniform(0),
    crackWidth: uniform(2.6),
    crackColor: colorUniform("#0b0d12"),
    crackHighlight: uniform(1.6),
    edgeColor: colorUniform("#bcd7ff"),
    lightColor: colorUniform("#ffffff"),
    lightIntensity: uniform(1.6),
    lightThreshold: uniform(0.12),
    fresnel: uniform(0.35),
    lightPosition: uniform(new Vector3(-0.35, 0.4, 0.7)),
    spotIntensity: uniform(1.4),
    spotShininess: uniform(160),
    sheen: uniform(0.25),
    tint: colorUniform("#cfe6df"),
    tintAmount: uniform(0.3),
    haze: uniform(0.0),
    envReflect: uniform(0),
    refraction: uniform(0.35),
  };
}

export type GlassParams = ReturnType<typeof createGlassParams>;

const band = (x: Float, from: Float, size: number, soft = 0.03) =>
  smoothstep(from, from.add(soft), x).mul(
    oneMinus(smoothstep(from.add(size), from.add(size + soft), x)),
  );

function softboxes(delta: Vec3, threshold: Float) {
  const top = band(delta.y, threshold, 0.35).mul(
    oneMinus(smoothstep(0.35, 0.45, abs(delta.x))),
  );
  const right = band(delta.x, threshold, 0.25).mul(
    oneMinus(smoothstep(0.12, 0.18, abs(delta.y.sub(0.05)))),
  );
  const left = band(delta.x.negate(), threshold.add(0.1), 0.12)
    .mul(oneMinus(smoothstep(0.05, 0.08, abs(delta.y.add(0.15)))))
    .mul(0.6);
  return top.add(right).add(left);
}

export function createGlassMaterial(params: GlassParams) {
  const edge = attribute("edge", "float") as unknown as Float;
  const crackOrder = attribute("crackOrder", "float") as unknown as Float;
  const isSide = step(abs(normalLocal.z), 0.5);
  const cracked = step(crackOrder, params.crackRadius);

  const refract = normalWorld.xy.mul(params.refraction).mul(cracked);
  const pageNode = texture(new Texture(), uv().add(refract.mul(vec2(1, -1))));
  const page = pageNode.rgb as unknown as Vec3;

  const pixel = fwidth(edge).max(0.00001);
  const line = oneMinus(smoothstep(0, pixel.mul(params.crackWidth), edge))
    .mul(cracked)
    .mul(oneMinus(isSide));
  const highlight = oneMinus(
    smoothstep(
      0,
      pixel.mul(params.crackWidth.mul(0.5)),
      abs(edge.sub(pixel.mul(params.crackWidth))),
    ),
  )
    .mul(cracked)
    .mul(oneMinus(isSide))
    .mul(params.crackHighlight);

  const N = normalView;
  const V = positionView.negate().normalize();
  const R = reflect(V.negate(), N) as unknown as Vec3;
  const restR = vec3(V.x.negate(), V.y.negate(), V.z);
  const delta = R.sub(restR);
  const facing = clamp(dot(N, V), 0, 1);
  const fresnel = pow(oneMinus(facing), 3).mul(params.fresnel);

  const L = params.lightPosition.sub(positionWorld).normalize();
  const toCamera = cameraPosition.sub(positionWorld).normalize();
  const H = L.add(toCamera).normalize();
  const NdotH = clamp(abs(dot(normalWorld, H)), 0, 1);
  const spot = pow(NdotH, params.spotShininess)
    .mul(params.spotIntensity)
    .add(pow(NdotH, params.spotShininess.mul(0.08)).mul(params.sheen))
    .mul(cracked);

  const specular = softboxes(delta, params.lightThreshold)
    .mul(params.lightIntensity)
    .add(fresnel)
    .add(spot);

  const environment = smoothstep(-0.3, 0.8, R.y).mul(0.8).add(0.2);
  const glassSheen = environment
    .mul(params.envReflect)
    .add(params.haze)
    .mul(cracked);

  const tinted = mix(
    page,
    page.mul(params.tint),
    params.tintAmount.mul(cracked),
  );
  let color: Vec3 = mix(tinted, params.edgeColor, isSide.mul(0.85));
  color = mix(color, params.crackColor, line.mul(0.9));
  color = color
    .add(params.tint.mul(glassSheen))
    .add(highlight)
    .add(params.lightColor.mul(specular));

  const material = new MeshBasicNodeMaterial({ side: DoubleSide });
  material.colorNode = vec4(color, 1);
  return { material, pageNode };
}
