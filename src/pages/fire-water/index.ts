import {
  MeshBasicNodeMaterial,
  QuadMesh,
  Vector2,
  Vector4,
  type WebGPURenderer,
} from "three/webgpu";
import {
  float,
  Fn,
  If,
  min,
  mix,
  oneMinus,
  screenSize,
  screenUV,
  select,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { AppContext } from "../../core/App";
import { ElementRegion } from "../../core/ElementRegion";
import type { Vec2, Vec3 } from "../../tsl/utils";
import { Page } from "../Page";
import {
  applyFire,
  burnDistortion,
  burnField,
  burnsHeat,
  createBurns,
  createFireParams,
  MAX_BURNS,
} from "./fire";
import {
  createImpacts,
  createRainParams,
  MAX_RIPPLES,
  rainStreaks,
  ripples,
  wetGlass,
} from "./rain";
import {
  applySwitchFrost,
  createSwitchParams,
} from "./switches";
import template from "./template.html?raw";
import style from "./style.css?inline";

const approach = (value: number, target: number, step: number) =>
  value < target
    ? Math.min(value + step, target)
    : Math.max(value - step, target);

const VIEW_MODES = {
  final: 0,
  "masque feu": 1,
  "déplacements (eau + feu)": 2,
  "zones switches": 3,
  "brûlures clic": 4,
};

export class FireWaterPage extends Page {
  readonly id = "fire-water";
  protected readonly template = template;
  protected readonly style = style;

  private material = new MeshBasicNodeMaterial();
  private quad = new QuadMesh(this.material);

  private time = uniform(0);
  private viewport = uniform(new Vector2(1, 1));
  private viewMode = uniform(0);

  private fire = createFireParams();
  private rain = createRainParams();
  private switches = createSwitchParams();
  private impacts = createImpacts();
  private burns = createBurns();
  private nextBurn = 0;
  private nextImpact = 0;
  private rippleBudget = 0;
  private elapsed = 0;

  private fireInput!: HTMLInputElement;
  private waterInput!: HTMLInputElement;
  private regions: ElementRegion[] = [];

  private settings = {
    fireRampTime: 1.75,
    rainRampTime: 1,
    lookRampTime: 0.6,
    wetDuration: 12,
    dryDuration: 8,
    autoWetness: true,
    ripplesPerSecond: 6,
    rippleOnClick: true,
    burnOnClick: true,
  };

  protected setup(_ctx: AppContext) {
    this.fireInput =
      this.root.querySelector<HTMLInputElement>('input[name="fire"]')!;
    this.waterInput = this.root.querySelector<HTMLInputElement>(
      'input[name="water"]',
    )!;
    this.regions = [...this.root.querySelectorAll<HTMLElement>(".choice")].map(
      (choice) => new ElementRegion(choice),
    );

    this.buildMaterial();
    this.buildDebug();

    this.root.addEventListener("pointerdown", (event) => {
      if ((event.target as HTMLElement).closest(".choice, .next-button")) return;
      const x = event.clientX / window.innerWidth;
      const y = event.clientY / window.innerHeight;
      if (this.settings.rippleOnClick && this.waterInput.checked) {
        this.spawnRipple(x, y);
      }
      if (this.settings.burnOnClick && this.fireInput.checked) {
        this.spawnBurn(x, y);
      }
    });
  }

  private buildMaterial() {
    const { fire, rain, switches, time } = this;
    const uv = screenUV as unknown as Vec2;
    const aspect = screenSize.x.div(screenSize.y);
    const pixel = uv.mul(this.viewport);
    const aspectUV = vec2(uv.x.mul(aspect), uv.y);
    const toUV = vec2(aspect, 1);
    const html = (at: Vec2) =>
      texture(this.html.texture, at).rgb as unknown as Vec3;

    const [a, b] = this.regions;
    const switchD = min(a.sdf(pixel), b.sdf(pixel));

    const burnAt = (offset: Vec2) =>
      burnField(
        aspectUV.add(offset),
        time,
        fire,
        burnsHeat(aspectUV.add(offset), aspect, time, this.burns, fire),
      );

    const fireActive = fire.amount.greaterThan(0.001);
    const waterActive = rain.amount
      .greaterThan(0.001)
      .or(rain.wetness.greaterThan(0.001));
    const frostActive = switches.frostLook.greaterThan(0.001);

    const shade = Fn(() => {
      const heat = float(0).toVar();
      const burnD = float(1).toVar();
      const fireOffset = vec2(0, 0).toVar();
      const waterOffset = vec2(0, 0).toVar();
      const wetMask = float(0).toVar();
      const rippleLight = float(0).toVar();

      If(fireActive, () => {
        heat.assign(burnsHeat(aspectUV, aspect, time, this.burns, fire));
        burnD.assign(burnField(aspectUV, time, fire, heat));
        If(burnD.lessThan(fire.warpWidth.mul(4)), () => {
          fireOffset.assign(
            burnDistortion(aspectUV, burnD, burnAt, time, fire).div(toUV),
          );
        });
      });

      If(waterActive, () => {
        const glass = wetGlass(uv, aspect, time, rain);
        const rip = ripples(uv, aspect, time, this.impacts, rain);
        waterOffset.assign(rip.offset.sub(glass.offset));
        wetMask.assign(glass.mask);
        rippleLight.assign(rip.light);
      });

      const distortedUV = uv.add(waterOffset).add(fireOffset);
      const color = html(distortedUV).toVar();

      If(waterActive, () => {
        color.assign(
          mix(color, color.mul(rain.wetTint), rain.wetness.mul(0.35))
            .add(wetMask.mul(0.06))
            .add(rippleLight.mul(0.25)),
        );
      });

      If(frostActive, () => {
        const r = switches.frostBlur;
        const blurred = html(distortedUV)
          .add(html(distortedUV.add(vec2(r, 0))))
          .add(html(distortedUV.sub(vec2(r, 0))))
          .add(html(distortedUV.add(vec2(0, r))))
          .add(html(distortedUV.sub(vec2(0, r))))
          .add(html(distortedUV.add(vec2(r, r).mul(0.7))))
          .add(html(distortedUV.sub(vec2(r, r).mul(0.7))))
          .add(html(distortedUV.add(vec2(r, r.negate()).mul(0.7))))
          .add(html(distortedUV.sub(vec2(r, r.negate()).mul(0.7))))
          .div(9);
        color.assign(
          applySwitchFrost(color, blurred, switchD, pixel, time, switches),
        );
      });

      If(fireActive, () => {
        color.assign(applyFire(color, burnD, aspectUV, time, fire));
      });

      If(rain.amount.greaterThan(0.001), () => {
        color.addAssign(rainStreaks(uv, aspect, time, rain));
      });

      const burnView = vec3(burnD.mul(4).add(0.5));
      const waterView = vec3(
        waterOffset.add(fireOffset).mul(40).add(0.5),
        wetMask,
      );
      const switchView = vec3(oneMinus(smoothstep(-1, 1, switchD)));
      const heatView = vec3(heat, heat.mul(0.3), 0);
      const output = select(
        this.viewMode.equal(1),
        burnView,
        select(
          this.viewMode.equal(2),
          waterView,
          select(
            this.viewMode.equal(3),
            switchView,
            select(this.viewMode.equal(4), heatView, color),
          ),
        ),
      );

      return vec4(output, 1);
    });

    this.material.colorNode = shade();
  }

  private spawnRipple(x: number, y: number, strength = 1) {
    (this.impacts.array[this.nextImpact] as Vector4).set(
      x,
      y,
      this.elapsed,
      strength,
    );
    this.nextImpact = (this.nextImpact + 1) % MAX_RIPPLES;
  }

  private spawnBurn(x: number, y: number) {
    (this.burns.array[this.nextBurn] as Vector4).set(x, y, this.elapsed, 1);
    this.nextBurn = (this.nextBurn + 1) % MAX_BURNS;
  }

  update(delta: number, elapsed: number) {
    this.elapsed = elapsed;
    this.time.value = elapsed;
    this.viewport.value.set(window.innerWidth, window.innerHeight);
    for (const region of this.regions) region.update();

    const fireOn = this.fireInput.checked ? 1 : 0;
    const waterOn = this.waterInput.checked ? 1 : 0;
    const s = this.settings;

    this.fire.amount.value = approach(
      this.fire.amount.value,
      fireOn,
      delta / s.fireRampTime,
    );
    this.rain.amount.value = approach(
      this.rain.amount.value,
      waterOn,
      delta / s.rainRampTime,
    );
    this.switches.frostLook.value = approach(
      this.switches.frostLook.value,
      waterOn,
      delta / s.lookRampTime,
    );

    if (s.autoWetness) {
      const step = waterOn ? delta / s.wetDuration : -delta / s.dryDuration;
      this.rain.wetness.value = Math.min(
        1,
        Math.max(0, this.rain.wetness.value + step),
      );
    }

    this.rippleBudget += delta * s.ripplesPerSecond * this.rain.amount.value;
    while (this.rippleBudget >= 1) {
      this.rippleBudget -= 1;
      this.spawnRipple(Math.random(), Math.random(), 0.5 + Math.random() * 0.5);
    }
  }

  protected draw(renderer: WebGPURenderer) {
    this.quad.render(renderer);
  }

  private buildDebug() {
    const { fire, rain, switches, settings } = this;
    const debug = this.debug;

    debug.addBinding(this.viewMode, "value", {
      label: "vue",
      options: VIEW_MODES,
    });
    debug
      .addButton({ title: "basculer feu" })
      .on("click", () => this.fireInput.click());
    debug
      .addButton({ title: "basculer eau" })
      .on("click", () => this.waterInput.click());

    const state = debug.addFolder({ title: "état", expanded: false });
    state.addBinding(fire.amount, "value", { label: "feu", readonly: true });
    state.addBinding(rain.amount, "value", { label: "pluie", readonly: true });
    state.addBinding(rain.wetness, "value", {
      label: "wetness",
      readonly: true,
    });

    const color = { color: { type: "float" as const } };

    const fireFolder = debug.addFolder({ title: "feu", expanded: false });
    fireFolder.addBinding(settings, "fireRampTime", {
      label: "montée (s)",
      min: 0.1,
      max: 10,
    });
    fireFolder.addBinding(fire.coverage, "value", {
      label: "couverture",
      min: 0,
      max: 0.8,
    });
    fireFolder.addBinding(fire.scale, "value", {
      label: "échelle",
      min: 0.5,
      max: 10,
    });
    fireFolder.addBinding(fire.speed, "value", {
      label: "vitesse",
      min: 0,
      max: 1,
    });
    fireFolder.addBinding(fire.detail, "value", {
      label: "irrégularité",
      min: 0,
      max: 0.3,
    });
    fireFolder.addBinding(fire.edgeWidth, "value", {
      label: "liseré",
      min: 0.001,
      max: 0.1,
    });
    fireFolder.addBinding(fire.charWidth, "value", {
      label: "roussi",
      min: 0.001,
      max: 0.4,
    });
    fireFolder.addBinding(fire.glowWidth, "value", {
      label: "halo",
      min: 0.001,
      max: 0.2,
    });
    fireFolder.addBinding(fire.glowIntensity, "value", {
      label: "intensité",
      min: 0,
      max: 8,
    });
    fireFolder.addBinding(settings, "burnOnClick", { label: "clic: brûlure" });
    fireFolder.addBinding(fire.ignite, "value", {
      label: "clic: allumage",
      min: 0,
      max: 1.5,
    });
    fireFolder.addBinding(fire.burnRadius, "value", {
      label: "clic: rayon",
      min: 0.01,
      max: 0.5,
    });
    fireFolder.addBinding(fire.burnGrow, "value", {
      label: "clic: croissance (s)",
      min: 0.1,
      max: 6,
    });
    fireFolder.addBinding(fire.burnHold, "value", {
      label: "clic: durée (s)",
      min: 0,
      max: 20,
    });
    fireFolder.addBinding(fire.burnFade, "value", {
      label: "clic: fermeture (s)",
      min: 0.1,
      max: 10,
    });
    fireFolder
      .addButton({ title: "brûlure au centre" })
      .on("click", () => this.spawnBurn(0.5, 0.5));
    fireFolder.addBinding(fire.warp, "value", {
      label: "déform: traction",
      min: -0.05,
      max: 0.05,
    });
    fireFolder.addBinding(fire.warpWidth, "value", {
      label: "déform: portée",
      min: 0.005,
      max: 0.5,
    });
    fireFolder.addBinding(fire.shimmer, "value", {
      label: "déform: tremblement",
      min: 0,
      max: 0.02,
    });
    fireFolder.addBinding(fire.shimmerScale, "value", {
      label: "déform: échelle",
      min: 1,
      max: 60,
    });
    fireFolder.addBinding(fire.shimmerSpeed, "value", {
      label: "déform: vitesse",
      min: 0,
      max: 10,
    });
    fireFolder.addBinding(fire.glowColor, "value", { label: "glow", ...color });
    fireFolder.addBinding(fire.emberColor, "value", {
      label: "braise",
      ...color,
    });
    fireFolder.addBinding(fire.charColor, "value", {
      label: "roussi",
      ...color,
    });
    fireFolder.addBinding(fire.holeColor, "value", { label: "trou", ...color });

    const rainFolder = debug.addFolder({ title: "pluie", expanded: false });
    rainFolder.addBinding(settings, "rainRampTime", {
      label: "montée (s)",
      min: 0.1,
      max: 5,
    });
    rainFolder.addBinding(rain.angle, "value", {
      label: "angle",
      min: -Math.PI,
      max: Math.PI,
    });
    rainFolder.addBinding(rain.density, "value", {
      label: "densité",
      min: 5,
      max: 200,
    });
    rainFolder.addBinding(rain.speed, "value", {
      label: "vitesse",
      min: 0,
      max: 10,
    });
    rainFolder.addBinding(rain.streakLength, "value", {
      label: "longueur",
      min: 0.02,
      max: 0.9,
    });
    rainFolder.addBinding(rain.streakOpacity, "value", {
      label: "opacité",
      min: 0,
      max: 1,
    });

    const rippleFolder = debug.addFolder({ title: "ripples", expanded: false });
    rippleFolder.addBinding(settings, "ripplesPerSecond", {
      label: "par seconde",
      min: 0,
      max: 20,
    });
    rippleFolder.addBinding(settings, "rippleOnClick", { label: "au clic" });
    rippleFolder.addBinding(rain.rippleSpeed, "value", {
      label: "vitesse",
      min: 0.01,
      max: 1,
    });
    rippleFolder.addBinding(rain.rippleWidth, "value", {
      label: "largeur",
      min: 0.001,
      max: 0.05,
    });
    rippleFolder.addBinding(rain.rippleStrength, "value", {
      label: "force",
      min: 0,
      max: 0.05,
    });
    rippleFolder.addBinding(rain.rippleLife, "value", {
      label: "durée",
      min: 0.1,
      max: 4,
    });
    rippleFolder
      .addButton({ title: "ripple au centre" })
      .on("click", () => this.spawnRipple(0.5, 0.5));

    const wetFolder = debug.addFolder({
      title: "page mouillée",
      expanded: false,
    });
    wetFolder.addBinding(settings, "autoWetness", { label: "auto" });
    wetFolder.addBinding(rain.wetness, "value", {
      label: "wetness",
      min: 0,
      max: 1,
    });
    wetFolder.addBinding(settings, "wetDuration", {
      label: "mouillage (s)",
      min: 1,
      max: 60,
    });
    wetFolder.addBinding(settings, "dryDuration", {
      label: "séchage (s)",
      min: 1,
      max: 60,
    });
    wetFolder.addBinding(rain.dropScale, "value", {
      label: "gouttes",
      min: 2,
      max: 60,
    });
    wetFolder.addBinding(rain.dropLens, "value", {
      label: "réfraction",
      min: 0,
      max: 3,
    });
    wetFolder.addBinding(rain.trickleColumns, "value", {
      label: "coulures",
      min: 2,
      max: 40,
    });
    wetFolder.addBinding(rain.trickleSpeed, "value", {
      label: "vitesse",
      min: 0,
      max: 0.5,
    });
    wetFolder.addBinding(rain.wetTint, "value", { label: "teinte", ...color });

    const switchFolder = debug.addFolder({
      title: "switches",
      expanded: false,
    });
    switchFolder.addBinding(settings, "lookRampTime", {
      label: "transition (s)",
      min: 0.05,
      max: 3,
    });
    switchFolder.addBinding(switches.frostBlur, "value", {
      label: "flou",
      min: 0,
      max: 0.02,
    });
    switchFolder.addBinding(switches.fog, "value", {
      label: "buée",
      min: 0,
      max: 1,
    });
    switchFolder.addBinding(switches.rim, "value", {
      label: "reflet bord",
      min: 0,
      max: 2,
    });
    switchFolder.addBinding(switches.frostColor, "value", {
      label: "givre",
      ...color,
    });
  }

  dispose() {
    this.material.dispose();
    super.dispose();
  }
}
