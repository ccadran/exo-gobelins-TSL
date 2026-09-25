import { MeshBasicNodeMaterial, QuadMesh, Texture, Vector2, type WebGPURenderer } from "three/webgpu";
import { mix, screenSize, screenUV, smoothstep, texture, uniform, vec2 } from "three/tsl";
import type { FolderApi } from "tweakpane";
import type { Transition, TransitionStart } from "../Transition";

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// Transition de test : un cercle part de `origin` et s'élargit en révélant la page suivante.
export class CircleTransition implements Transition {
  readonly steps = 1;
  duration = 1.2;

  private progress = uniform(0);
  private origin = uniform(new Vector2(0.5, 0.5));
  private maxRadius = uniform(1);
  private softness = uniform(0.01);
  // Nœuds gardés tels quels dans le graphe : on change leur `.value` à chaque start().
  // (Ne pas utiliser `.sample()` ici : il clone le nœud et figerait la texture.)
  private fromNode = texture(new Texture(), screenUV);
  private toNode = texture(new Texture(), screenUV);
  private material = new MeshBasicNodeMaterial();
  private quad = new QuadMesh(this.material);
  private elapsed = 0;
  private running = false;

  constructor(debug: FolderApi) {
    const aspect = vec2(screenSize.x.div(screenSize.y), 1);
    const distance = screenUV.sub(this.origin).mul(aspect).length();
    // Le rayon va de 0 à la distance du coin le plus éloigné (+ la douceur du bord).
    const radius = this.progress.mul(this.maxRadius.add(this.softness));
    const outside = smoothstep(radius.sub(this.softness), radius, distance);

    this.material.colorNode = mix(this.toNode, this.fromNode, outside);

    debug.addBinding(this, "duration", { min: 0.2, max: 4 });
    debug.addBinding(this.softness, "value", { label: "softness", min: 0, max: 0.2 });
  }

  get done() {
    return !this.running;
  }

  start({ from, to, origin }: TransitionStart) {
    this.fromNode.value = from;
    this.toNode.value = to;
    this.origin.value.copy(origin);

    const aspect = window.innerWidth / window.innerHeight;
    const corners = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ];
    this.maxRadius.value = Math.max(
      ...corners.map(([x, y]) => Math.hypot((x - origin.x) * aspect, y - origin.y)),
    );

    this.elapsed = 0;
    this.progress.value = 0;
    this.running = true;
  }

  hit() {}

  cancel() {
    this.running = false;
  }

  update(delta: number) {
    if (!this.running) return;
    this.elapsed += delta;
    const t = Math.min(this.elapsed / this.duration, 1);
    this.progress.value = easeInOutCubic(t);
    if (t >= 1) this.running = false;
  }

  render(renderer: WebGPURenderer) {
    this.quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
  }
}
