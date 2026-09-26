import {
  Euler,
  MeshBasicNodeMaterial,
  Mesh,
  PerspectiveCamera,
  QuadMesh,
  Scene,
  Texture,
  Vector2,
  Vector3,
  type WebGPURenderer,
} from "three/webgpu";
import { screenUV, texture } from "three/tsl";
import type { FolderApi } from "tweakpane";
import type { Pointer } from "../../core/Pointer";
import type { Transition, TransitionStart } from "../Transition";
import { createGlassMaterial, createGlassParams } from "./material";
import { createShardGeometry } from "./shards";
import { centroid, createSeeds, voronoiCell, type P2 } from "./voronoi";

const FOV = 50;
const PLANE_HEIGHT = 1;

type Shard = {
  mesh: Mesh;
  distance: number;
  crackOrder: number;
  tilt: Euler;
  tiltProgress: number;
  fallStart: number;
  origin: Vector3;
  originRotation: Euler;
  velocity: Vector3;
  spin: Vector3;
};

const random = (min: number, max: number) => min + Math.random() * (max - min);
const ease = (t: number) => t * t * (3 - 2 * t);

export class CrackTransition implements Transition {
  stages = [
    { crack: 1.4, fall: 0.1 },
    { crack: 3, fall: 0.2 },
  ];

  settings = {
    radialSeeds: 55,
    uniformSeeds: 110,
    radialSpread: 0.5,
    depth: 0.012,
    crackSpeed: 3.8,
    tiltDegrees: 2,
    parallax: 0.12,
    parallaxFollow: 5,
    scatter: 0.75,
    buttonGuard: 0.12,
    fallSpeed: 0.35,
    fallForward: 0.6,
    gravity: 2.4,
    spin: 5,
    explodeSpeed: 0.9,
    explodeForward: 1.1,
    explodeDuration: 2.2,
  };

  private glass = createGlassParams();
  private material: MeshBasicNodeMaterial;
  private pageNode: ReturnType<typeof createGlassMaterial>["pageNode"];
  private backgroundNode = texture(new Texture(), screenUV);
  private backgroundMaterial = new MeshBasicNodeMaterial();
  private background = new QuadMesh(this.backgroundMaterial);
  private scene = new Scene();
  private camera = new PerspectiveCamera(FOV, 1, 0.01, 20);
  private cameraOffset = new Vector2();
  private cameraTarget = new Vector2();

  private shards: Shard[] = [];
  private impact: P2 = [0, 0];
  private hits = 0;
  private time = 0;
  private crackTarget = 0;
  private explodeTime = -1;
  private finished = false;

  private pointer: Pointer;

  constructor(debug: FolderApi, pointer: Pointer) {
    this.pointer = pointer;
    const { material, pageNode } = createGlassMaterial(this.glass);
    this.material = material;
    this.pageNode = pageNode;
    this.backgroundMaterial.colorNode = this.backgroundNode;
    this.buildDebug(debug);
  }

  get steps() {
    return this.stages.length + 1;
  }

  get done() {
    return this.finished;
  }

  start({ from, to, origin }: TransitionStart) {
    this.clearShards();
    this.pageNode.value = from;
    this.backgroundNode.value = to;

    const aspect = window.innerWidth / window.innerHeight;
    const halfWidth = (PLANE_HEIGHT * aspect) / 2;
    const halfHeight = PLANE_HEIGHT / 2;
    this.fitCamera();

    this.impact = [
      (origin.x - 0.5) * PLANE_HEIGHT * aspect,
      (0.5 - origin.y) * PLANE_HEIGHT,
    ];

    const s = this.settings;
    const seeds = createSeeds(halfWidth, halfHeight, {
      impact: this.impact,
      radial: s.radialSeeds,
      uniform: s.uniformSeeds,
      radialSpread: s.radialSpread,
    });
    const grow = PLANE_HEIGHT / window.innerHeight;
    const tilt = (s.tiltDegrees * Math.PI) / 180;

    seeds.forEach((_, i) => {
      const poly = voronoiCell(seeds, i, halfWidth, halfHeight);
      if (poly.length < 3) return;
      const center = centroid(poly);
      const distance = Math.hypot(
        center[0] - this.impact[0],
        center[1] - this.impact[1],
      );
      const crackOrder = distance * (1 - s.scatter * Math.random());
      const geometry = createShardGeometry({
        poly,
        center,
        halfWidth,
        halfHeight,
        depth: s.depth,
        grow,
        crackOrder,
      });
      const mesh = new Mesh(geometry, this.material);
      mesh.position.set(center[0], center[1], 0);
      this.scene.add(mesh);
      this.shards.push({
        mesh,
        distance,
        crackOrder,
        tilt: new Euler(
          random(-tilt, tilt),
          random(-tilt, tilt),
          random(-tilt, tilt) * 0.3,
        ),
        tiltProgress: 0,
        fallStart: -1,
        origin: new Vector3(),
        originRotation: new Euler(),
        velocity: new Vector3(),
        spin: new Vector3(),
      });
    });

    this.hits = 0;
    this.time = 0;
    this.crackTarget = 0;
    this.glass.crackRadius.value = 0;
    this.explodeTime = -1;
    this.finished = false;
  }

  cancel() {
    this.clearShards();
    this.explodeTime = -1;
    this.finished = false;
  }

  hit() {
    this.hits++;
    const stage = this.stages[this.hits - 1];

    if (stage) {
      this.crackTarget = stage.crack;
      const candidates = this.shards.filter(
        (shard) =>
          shard.fallStart < 0 && shard.distance > this.settings.buttonGuard,
      );
      const count = Math.round(this.shards.length * stage.fall);
      for (let i = 0; i < count && candidates.length; i++) {
        const [shard] = candidates.splice(
          Math.floor(Math.random() * candidates.length),
          1,
        );
        this.drop(shard, false);
      }
      return;
    }

    this.crackTarget = 100;
    this.explodeTime = this.time;
    for (const shard of this.shards) {
      if (shard.fallStart < 0) this.drop(shard, true);
    }
  }

  private drop(shard: Shard, explode: boolean) {
    const s = this.settings;
    const { mesh } = shard;
    let dx = mesh.position.x - this.impact[0];
    let dy = mesh.position.y - this.impact[1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-4) {
      const angle = Math.random() * Math.PI * 2;
      dx = Math.cos(angle);
      dy = Math.sin(angle);
    } else {
      dx /= length;
      dy /= length;
    }

    const speed = (explode ? s.explodeSpeed : s.fallSpeed) * random(0.3, 1);
    const forward =
      (explode ? s.explodeForward : s.fallForward) * random(0.5, 1);
    shard.velocity.set(
      dx * speed,
      dy * speed * 0.6 + (explode ? random(0, 0.3) : 0),
      forward,
    );
    shard.spin
      .set(random(-1, 1), random(-1, 1), random(-1, 1))
      .multiplyScalar(s.spin);
    shard.origin.copy(mesh.position);
    shard.originRotation.copy(mesh.rotation);
    shard.fallStart = this.time;
  }

  update(delta: number) {
    this.time += delta;
    const s = this.settings;

    const pointer = this.pointer.uv.value;
    this.cameraTarget.set(
      (pointer.x - 0.5) * s.parallax,
      -(pointer.y - 0.5) * s.parallax,
    );
    this.cameraOffset.lerp(
      this.cameraTarget,
      1 - Math.exp(-delta * s.parallaxFollow),
    );

    const radius = this.glass.crackRadius.value;
    this.glass.crackRadius.value = Math.min(
      radius + delta * s.crackSpeed,
      this.crackTarget,
    );

    for (const shard of this.shards) {
      const { mesh } = shard;

      if (shard.fallStart < 0) {
        if (
          shard.crackOrder < this.glass.crackRadius.value &&
          shard.tiltProgress < 1
        ) {
          shard.tiltProgress = Math.min(1, shard.tiltProgress + delta * 8);
          const k = ease(shard.tiltProgress);
          mesh.rotation.set(
            shard.tilt.x * k,
            shard.tilt.y * k,
            shard.tilt.z * k,
          );
        }
        continue;
      }

      const t = this.time - shard.fallStart;
      mesh.position.set(
        shard.origin.x + shard.velocity.x * t,
        shard.origin.y + shard.velocity.y * t - 0.5 * s.gravity * t * t,
        shard.origin.z + shard.velocity.z * t,
      );
      mesh.rotation.set(
        shard.originRotation.x + shard.spin.x * t,
        shard.originRotation.y + shard.spin.y * t,
        shard.originRotation.z + shard.spin.z * t,
      );
      mesh.visible = mesh.position.y > -PLANE_HEIGHT * 2;
    }

    if (
      this.explodeTime >= 0 &&
      this.time - this.explodeTime > s.explodeDuration
    ) {
      this.finished = true;
    }
  }

  render(renderer: WebGPURenderer) {
    this.fitCamera();
    this.background.render(renderer);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }

  private fitCamera() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const { x, y } = this.cameraOffset;
    this.camera.aspect = width / height;
    this.camera.position.set(
      x,
      y,
      PLANE_HEIGHT / 2 / Math.tan((FOV * Math.PI) / 360),
    );
    const pixels = height / PLANE_HEIGHT;
    this.camera.setViewOffset(width, height, -x * pixels, y * pixels, width, height);
  }

  private clearShards() {
    for (const shard of this.shards) {
      shard.mesh.geometry.dispose();
      this.scene.remove(shard.mesh);
    }
    this.shards = [];
  }

  private buildDebug(debug: FolderApi) {
    const { settings, glass } = this;
    const color = { color: { type: "float" as const } };

    const fracture = debug.addFolder({ title: "fracture", expanded: false });
    fracture.addBinding(settings, "radialSeeds", {
      label: "éclats autour",
      min: 0,
      max: 200,
      step: 1,
    });
    fracture.addBinding(settings, "uniformSeeds", {
      label: "éclats page",
      min: 0,
      max: 200,
      step: 1,
    });
    fracture.addBinding(settings, "radialSpread", {
      label: "zone autour",
      min: 0.05,
      max: 1.5,
    });
    fracture.addBinding(settings, "depth", {
      label: "épaisseur",
      min: 0.001,
      max: 0.05,
    });
    this.stages.forEach((stage, i) => {
      fracture.addBinding(stage, "crack", {
        label: `clic ${i + 1}: fissures`,
        min: 0,
        max: 3,
      });
      fracture.addBinding(stage, "fall", {
        label: `clic ${i + 1}: chute (%)`,
        min: 0,
        max: 1,
      });
    });
    fracture.addBinding(settings, "crackSpeed", {
      label: "propagation",
      min: 0.1,
      max: 10,
    });
    fracture.addBinding(settings, "buttonGuard", {
      label: "zone bouton",
      min: 0,
      max: 0.5,
    });
    fracture.addBinding(settings, "scatter", {
      label: "dispersion",
      min: 0,
      max: 1,
    });
    fracture.addBinding(settings, "tiltDegrees", {
      label: "inclinaison (°)",
      min: 0,
      max: 10,
    });

    const motion = debug.addFolder({
      title: "chute / explosion",
      expanded: false,
    });
    motion.addBinding(settings, "fallSpeed", {
      label: "chute: vitesse",
      min: 0,
      max: 2,
    });
    motion.addBinding(settings, "fallForward", {
      label: "chute: vers caméra",
      min: 0,
      max: 3,
    });
    motion.addBinding(settings, "explodeSpeed", {
      label: "explo: vitesse",
      min: 0,
      max: 3,
    });
    motion.addBinding(settings, "explodeForward", {
      label: "explo: vers caméra",
      min: 0,
      max: 3,
    });
    motion.addBinding(settings, "gravity", {
      label: "gravité",
      min: 0,
      max: 10,
    });
    motion.addBinding(settings, "spin", { label: "rotation", min: 0, max: 20 });
    motion.addBinding(settings, "explodeDuration", {
      label: "durée explo (s)",
      min: 0.5,
      max: 6,
    });

    const look = debug.addFolder({ title: "verre", expanded: false });
    look.addBinding(glass.crackWidth, "value", {
      label: "fissure: épaisseur",
      min: 0.2,
      max: 6,
    });
    look.addBinding(glass.crackHighlight, "value", {
      label: "fissure: reflet",
      min: 0,
      max: 2,
    });
    look.addBinding(glass.crackColor, "value", { label: "fissure", ...color });
    look.addBinding(glass.edgeColor, "value", { label: "tranche", ...color });
    look.addBinding(glass.lightIntensity, "value", {
      label: "lumière",
      min: 0,
      max: 5,
    });
    look.addBinding(glass.lightThreshold, "value", {
      label: "lumière: seuil",
      min: 0,
      max: 0.6,
    });
    look.addBinding(glass.lightColor, "value", { label: "lumière", ...color });
    look.addBinding(glass.fresnel, "value", {
      label: "fresnel",
      min: 0,
      max: 2,
    });

    look.addBinding(glass.tint, "value", { label: "teinte", ...color });
    look.addBinding(glass.tintAmount, "value", {
      label: "teinte: force",
      min: 0,
      max: 1,
    });
    look.addBinding(glass.haze, "value", { label: "voile", min: 0, max: 0.3 });
    look.addBinding(glass.envReflect, "value", {
      label: "reflet ambiant",
      min: 0,
      max: 1,
    });
    look.addBinding(glass.refraction, "value", {
      label: "réfraction",
      min: 0,
      max: 1.5,
    });

    const light = debug.addFolder({ title: "lumière & parallaxe", expanded: false });
    light.addBinding(glass.lightPosition, "value", { label: "position" });
    light.addBinding(settings, "parallax", {
      label: "parallaxe",
      min: 0,
      max: 0.5,
    });
    light.addBinding(settings, "parallaxFollow", {
      label: "parallaxe: réactivité",
      min: 0.5,
      max: 30,
    });
    light.addBinding(glass.spotIntensity, "value", {
      label: "reflet net",
      min: 0,
      max: 5,
    });
    light.addBinding(glass.spotShininess, "value", {
      label: "netteté",
      min: 5,
      max: 1000,
    });
    light.addBinding(glass.sheen, "value", {
      label: "reflet doux",
      min: 0,
      max: 2,
    });
  }

  dispose() {
    this.clearShards();
    this.material.dispose();
    this.backgroundMaterial.dispose();
  }
}
