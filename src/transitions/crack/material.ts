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
    crackRadius: uniform(0), // les éclats dont l'ordre de fissure est en dessous sont fissurés
    crackWidth: uniform(2.6), // épaisseur de la ligne de fissure (px environ)
    crackColor: colorUniform("#0b0d12"),
    crackHighlight: uniform(1.6), // liseré clair le long de la fissure
    edgeColor: colorUniform("#bcd7ff"), // tranche du verre
    lightColor: colorUniform("#ffffff"),
    lightIntensity: uniform(1.6),
    // Les softbox sont repérées par rapport au reflet "au repos" (vitre à plat) : un éclat
    // doit pivoter de quelques degrés avant de refléter quoi que ce soit (page intacte au pixel).
    lightThreshold: uniform(0.12),
    fresnel: uniform(0.35),
    // Lumière fixe devant la page (repère monde : page de 1 de haut, centrée en 0, z vers la
    // caméra). Allumée seulement sur les éclats fissurés : chaque éclat, un peu incliné, la
    // reflète différemment (on voit les facettes). La parallaxe de la caméra fait glisser le reflet.
    lightPosition: uniform(new Vector3(-0.35, 0.4, 0.7)),
    spotIntensity: uniform(1.4), // reflet net
    spotShininess: uniform(160), // plus c'est haut, plus le reflet est petit et net
    sheen: uniform(0.25), // reflet large et doux
    // Le verre, posé au-dessus du contenu (seulement sur les éclats fissurés).
    tint: colorUniform("#cfe6df"), // teinte du verre (légèrement vert-bleu)
    tintAmount: uniform(0.3),
    haze: uniform(0.0), // voile clair
    envReflect: uniform(0), // reflet doux de l'environnement sur toute la surface
    refraction: uniform(0.35), // décalage du contenu sous les éclats inclinés
  };
}

export type GlassParams = ReturnType<typeof createGlassParams>;

// Bande lumineuse entre `from` et `from + size` sur un axe (bords doux).
const band = (x: Float, from: Float, size: number, soft = 0.03) =>
  smoothstep(from, from.add(soft), x).mul(
    oneMinus(smoothstep(from.add(size), from.add(size + soft), x)),
  );

// "Studio" procédural : quelques panneaux lumineux, repérés par `delta` = écart entre la
// direction de reflet actuelle et celle d'une vitre à plat (0 au repos).
function softboxes(delta: Vec3, threshold: Float) {
  // Grand panneau en haut.
  const top = band(delta.y, threshold, 0.35).mul(
    oneMinus(smoothstep(0.35, 0.45, abs(delta.x))),
  );
  // Bande verticale à droite.
  const right = band(delta.x, threshold, 0.25).mul(
    oneMinus(smoothstep(0.12, 0.18, abs(delta.y.sub(0.05)))),
  );
  // Bande fine à gauche, plus faible.
  const left = band(delta.x.negate(), threshold.add(0.1), 0.12)
    .mul(oneMinus(smoothstep(0.05, 0.08, abs(delta.y.add(0.15)))))
    .mul(0.6);
  return top.add(right).add(left);
}

// Matériau des éclats. `pageNode.value` = texture de la page qui se casse (remplacée à
// chaque transition, d'où un nœud persistant plutôt que `.sample()`).
export function createGlassMaterial(params: GlassParams) {
  const edge = attribute("edge", "float") as unknown as Float;
  const crackOrder = attribute("crackOrder", "float") as unknown as Float;
  const isSide = step(abs(normalLocal.z), 0.5);
  const cracked = step(crackOrder, params.crackRadius);

  // Réfraction : sous un éclat incliné, le contenu est un peu décalé (effet d'épaisseur).
  // Nul pour un éclat à plat (normale = +z) : la page intacte reste identique.
  const refract = normalWorld.xy.mul(params.refraction).mul(cracked);
  const pageNode = texture(new Texture(), uv().add(refract.mul(vec2(1, -1))));
  const page = pageNode.rgb as unknown as Vec3;

  // Fissure : ligne le long du bord de l'éclat, épaisseur constante à l'écran grâce à fwidth.
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

  // Reflet : direction de reflet de la vue sur la normale de l'éclat.
  const N = normalView;
  const V = positionView.negate().normalize();
  const R = reflect(V.negate(), N) as unknown as Vec3;
  // Reflet sur une vitre à plat (normale +z en repère vue) = (-V.x, -V.y, V.z).
  const restR = vec3(V.x.negate(), V.y.negate(), V.z);
  const delta = R.sub(restR);
  const facing = clamp(dot(N, V), 0, 1);
  const fresnel = pow(oneMinus(facing), 3).mul(params.fresnel);

  // Lumière fixe : reflet (Blinn-Phong) selon l'inclinaison de chaque éclat.
  const L = params.lightPosition.sub(positionWorld).normalize();
  const toCamera = cameraPosition.sub(positionWorld).normalize();
  const H = L.add(toCamera).normalize();
  // abs : les deux faces du verre reflètent (éclats qui se retournent en tombant).
  const NdotH = clamp(abs(dot(normalWorld, H)), 0, 1);
  const spot = pow(NdotH, params.spotShininess)
    .mul(params.spotIntensity)
    .add(pow(NdotH, params.spotShininess.mul(0.08)).mul(params.sheen))
    .mul(cracked);

  const specular = softboxes(delta, params.lightThreshold)
    .mul(params.lightIntensity)
    .add(fresnel)
    .add(spot);

  // Reflet d'environnement : dégradé ciel clair / sol sombre vu dans le verre. Il bouge
  // avec la parallaxe, ce qui détache le verre du contenu.
  const environment = smoothstep(-0.3, 0.8, R.y).mul(0.8).add(0.2);
  const glassSheen = environment
    .mul(params.envReflect)
    .add(params.haze)
    .mul(cracked);

  // Contenu vu à travers le verre teinté.
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
