import {
  HalfFloatType,
  MeshBasicNodeMaterial,
  QuadMesh,
  RenderTarget,
  Vector2,
  type WebGPURenderer,
} from "three/webgpu";
import { texture, vec4 } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import type { AppContext } from "../../core/App";
import type { Vec3 } from "../../tsl/utils";
import { Page } from "../Page";
import { createRetroEffects, createRetroParams, crtImage, crtScreen } from "./crt";
import template from "./template.html?raw";
import style from "./style.css?inline";

const size = new Vector2();

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / Math.max(edge1 - edge0, 1e-6)));
  return t * t * (3 - 2 * t);
};

export class RetroPage extends Page {
  readonly id = "retro";
  protected readonly template = template;
  protected readonly style = style;

  private effects = createRetroEffects();
  private params = createRetroParams();
  private crtTarget = new RenderTarget(1, 1, { type: HalfFloatType });
  private imageMaterial = new MeshBasicNodeMaterial();
  private screenMaterial = new MeshBasicNodeMaterial();
  private screenMaterialNoBloom = new MeshBasicNodeMaterial();
  private imageQuad = new QuadMesh(this.imageMaterial);
  private screenQuad = new QuadMesh(this.screenMaterial);

  private slider!: HTMLInputElement;

  private state = {
    value: 0,
    intensity: 0,
    smoothing: 6,
    manual: false,
  };

  protected setup(_ctx: AppContext) {
    this.slider = this.root.querySelector<HTMLInputElement>("#like")!;

    this.imageMaterial.colorNode = vec4(crtImage(this.html.texture, this.effects, this.params), 1);

    const image = texture(this.crtTarget.texture);
    const glow = bloom(
      image,
      this.params.bloomStrength,
      this.params.bloomRadius,
      this.params.bloomThreshold,
    );
    const withGlow = image.rgb.add(glow.rgb) as unknown as Vec3;
    this.screenMaterial.colorNode = vec4(crtScreen(withGlow, this.effects, this.params), 1);
    this.screenMaterialNoBloom.colorNode = vec4(
      crtScreen(image.rgb as unknown as Vec3, this.effects, this.params),
      1,
    );

    this.buildDebug();
  }

  resize(renderer: WebGPURenderer) {
    super.resize(renderer);
    renderer.getDrawingBufferSize(size);
    this.crtTarget.setSize(size.x, size.y);
  }

  update(delta: number, elapsed: number) {
    const s = this.state;
    s.value = Number(this.slider.value);
    if (!s.manual) {
      const target = s.value / 100;
      s.intensity += (target - s.intensity) * (1 - Math.exp(-delta * s.smoothing));
    }

    for (const effect of Object.values(this.effects)) {
      effect.value.value = smoothstep(effect.start, effect.end, s.intensity) * effect.max;
    }
    this.params.bloomStrength.value = this.effects.bloom.value.value * this.params.bloomMax;
    this.params.time.value = elapsed;
  }

  protected draw(renderer: WebGPURenderer) {
    const target = renderer.getRenderTarget();
    renderer.setRenderTarget(this.crtTarget);
    this.imageQuad.render(renderer);
    renderer.setRenderTarget(target);
    this.screenQuad.material =
      this.params.bloomStrength.value > 0.001 ? this.screenMaterial : this.screenMaterialNoBloom;
    this.screenQuad.render(renderer);
  }

  private buildDebug() {
    const { effects, params, state } = this;
    const debug = this.debug;

    debug.addBinding(state, "value", { label: "slider", readonly: true, format: (v) => v.toFixed(0) });
    debug.addBinding(state, "manual", { label: "intensité manuelle" });
    debug.addBinding(state, "intensity", { label: "intensité", min: 0, max: 1 });
    debug.addBinding(state, "smoothing", { label: "réactivité", min: 0.5, max: 30 });

    const ranges = debug.addFolder({ title: "plages des effets", expanded: false });
    const labels: Record<keyof typeof effects, string> = {
      scanlines: "scanlines",
      noise: "bruit",
      chroma: "aberration",
      bloom: "bloom",
      curve: "courbure",
      interlace: "entrelacement",
    };
    for (const key of Object.keys(effects) as (keyof typeof effects)[]) {
      const effect = effects[key];
      const folder = ranges.addFolder({ title: labels[key], expanded: false });
      folder.addBinding(effect, "start", { label: "début", min: 0, max: 1 });
      folder.addBinding(effect, "end", { label: "plein", min: 0, max: 1 });
      folder.addBinding(effect, "max", { label: "max", min: 0, max: 2 });
      folder.addBinding(effect.value, "value", { label: "actuel", readonly: true });
    }

    const curve = debug.addFolder({ title: "courbure", expanded: false });
    curve.addBinding(params.curve, "value", { label: "bombé", min: 0, max: 0.9 });
    curve.addBinding(params.vignette, "value", { label: "vignettage", min: 0, max: 4 });

    const scan = debug.addFolder({ title: "scanlines", expanded: false });
    scan.addBinding(params.linePeriod, "value", { label: "hauteur ligne (px)", min: 1, max: 12, step: 1 });
    scan.addBinding(params.scanDarkness, "value", { label: "noirceur", min: 0, max: 1 });
    scan.addBinding(params.maskStrength, "value", { label: "masque RGB", min: 0, max: 1 });
    scan.addBinding(params.rollSpeed, "value", { label: "balayage: vitesse", min: 0, max: 3 });
    scan.addBinding(params.rollCount, "value", { label: "balayage: bandes", min: 1, max: 10, step: 1 });
    scan.addBinding(params.rollStrength, "value", { label: "balayage: force", min: 0, max: 0.5 });

    const color = debug.addFolder({ title: "aberration", expanded: false });
    color.addBinding(params.chroma, "value", { label: "décalage", min: 0, max: 0.05 });

    const glow = debug.addFolder({ title: "bloom", expanded: false });
    glow.addBinding(params, "bloomMax", { label: "force max", min: 0, max: 3 });
    glow.addBinding(params.bloomRadius, "value", { label: "rayon", min: 0, max: 1 });
    glow.addBinding(params.bloomThreshold, "value", { label: "seuil", min: 0, max: 1 });

    const noise = debug.addFolder({ title: "bruit", expanded: false });
    noise.addBinding(params.grain, "value", { label: "grain", min: 0, max: 0.5 });
    noise.addBinding(params.flicker, "value", { label: "scintillement", min: 0, max: 0.3 });

    const interlace = debug.addFolder({ title: "entrelacement", expanded: false });
    interlace.addBinding(params.interlaceDarkness, "value", { label: "lignes alternées", min: 0, max: 1 });
    interlace.addBinding(params.tearChance, "value", { label: "lignes décalées", min: 0, max: 0.3 });
    interlace.addBinding(params.tearOffset, "value", { label: "décalage", min: 0, max: 0.05 });
  }

  dispose() {
    this.imageMaterial.dispose();
    this.screenMaterial.dispose();
    this.screenMaterialNoBloom.dispose();
    this.crtTarget.dispose();
    super.dispose();
  }
}
