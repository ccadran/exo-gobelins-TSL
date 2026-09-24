import { MeshBasicNodeMaterial, QuadMesh, Texture, Vector2, type WebGPURenderer } from "three/webgpu";
import { screenUV, texture } from "three/tsl";
import type { Page } from "../pages/Page";
import type { Transition } from "../transitions/Transition";
import type { AppContext } from "./App";

export type PageFactory = () => Page;

// Enchaîne les pages dans l'ordre (suite linéaire, on reboucle à la fin pour l'instant).
// Chaque page rend dans son `output` ; le manager affiche soit la page courante,
// soit la transition entre la page sortante et la page entrante.
export class PageManager {
  private ctx: AppContext;
  private factories: PageFactory[];
  private transition: Transition;
  private index = 0;
  private current: Page;
  private incoming: Page | null = null;
  private transitionStarted = false;
  private origin = new Vector2();

  private displayNode = texture(new Texture(), screenUV);
  private displayMaterial = new MeshBasicNodeMaterial();
  private displayQuad = new QuadMesh(this.displayMaterial);

  constructor(ctx: AppContext, factories: PageFactory[], transition: Transition) {
    this.ctx = ctx;
    this.factories = factories;
    this.transition = transition;
    this.displayMaterial.colorNode = this.displayNode;

    this.current = this.mountPage(0);
    this.displayNode.value = this.current.output.texture;
  }

  get transitioning() {
    return this.incoming !== null;
  }

  // origin : point de départ de la transition, repère screenUV.
  next(origin: Vector2) {
    if (this.transitioning) return;
    this.index = (this.index + 1) % this.factories.length;
    this.current.leave();
    this.incoming = this.mountPage(this.index);
    this.origin.copy(origin);
    // La transition démarre dans update(), une fois le DOM de la page entrante copié.
  }

  resize() {
    this.current.resize(this.ctx.renderer);
    this.incoming?.resize(this.ctx.renderer);
  }

  update(delta: number, elapsed: number) {
    this.current.update(delta, elapsed);
    if (!this.incoming) return;

    this.incoming.update(delta, elapsed);

    if (this.transition.done && this.incoming.ready && !this.transitionStarted) {
      this.transition.start({
        from: this.current.output.texture,
        to: this.incoming.output.texture,
        origin: this.origin,
      });
      this.transitionStarted = true;
      return;
    }

    this.transition.update(delta);

    if (this.transitionStarted && this.transition.done) {
      this.current.dispose();
      this.current = this.incoming;
      this.incoming = null;
      this.transitionStarted = false;
      this.displayNode.value = this.current.output.texture;
    }
  }

  render(renderer: WebGPURenderer) {
    this.current.render(renderer);
    this.incoming?.render(renderer);

    if (this.transitionStarted) this.transition.render(renderer);
    else this.displayQuad.render(renderer);
  }

  private mountPage(index: number) {
    const page = this.factories[index]();
    page.mount(this.ctx);
    return page;
  }
}
