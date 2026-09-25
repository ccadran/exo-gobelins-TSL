import { MeshBasicNodeMaterial, QuadMesh, Texture, Vector2, type WebGPURenderer } from "three/webgpu";
import { screenUV, texture } from "three/tsl";
import type { Page } from "../pages/Page";
import type { Transition } from "../transitions/Transition";
import type { AppContext } from "./App";

export type PageFactory = () => Page;

// Texte du bouton de la page à chaque clic (le dernier est réutilisé s'il en manque).
const NEXT_LABELS = ["Suivant", "Encore", "Allez"];

// Enchaîne les pages dans l'ordre (suite linéaire, on reboucle à la fin pour l'instant).
// Chaque page rend dans son `output` ; le manager affiche soit la page courante,
// soit la transition entre la page sortante et la page entrante.
//
// Le bouton "Suivant" est dans le DOM de chaque page. 1er clic : on monte la page suivante
// et on démarre la transition ; chaque clic la fait avancer ; au `transition.steps`-ième,
// elle part pour de bon, et on remplace la page quand elle est terminée.
export class PageManager {
  private ctx: AppContext;
  private factories: PageFactory[];
  private transition: Transition;
  private index = 0;
  private current: Page;
  private incoming: Page | null = null;
  private hits = 0;

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

  private onNext(page: Page) {
    if (page !== this.current || this.hits >= this.transition.steps) return;

    // Origine de l'effet : le centre du bouton, en screenUV.
    const rect = page.nextButton.getBoundingClientRect();
    const origin = new Vector2(
      (rect.left + rect.width / 2) / window.innerWidth,
      (rect.top + rect.height / 2) / window.innerHeight,
    );

    if (this.hits === 0) {
      this.index = (this.index + 1) % this.factories.length;
      this.incoming = this.mountPage(this.index);
      this.incoming.leave();
      this.transition.start({
        from: this.current.output.texture,
        to: this.incoming.output.texture,
        origin,
      });
    }

    this.hits++;
    this.transition.hit();

    if (this.hits >= this.transition.steps) this.current.leave();
    else page.nextButton.textContent = NEXT_LABELS[Math.min(this.hits, NEXT_LABELS.length - 1)];
  }

  // Navigation directe (debug) : abandonne l'éventuelle transition et monte la page `index`.
  goTo(index: number) {
    if (this.hits > 0) this.transition.cancel();
    this.incoming?.dispose();
    this.incoming = null;
    this.hits = 0;
    this.current.dispose();
    this.index = index;
    this.current = this.mountPage(index);
    this.displayNode.value = this.current.output.texture;
  }

  resize() {
    this.current.resize(this.ctx.renderer);
    this.incoming?.resize(this.ctx.renderer);
  }

  update(delta: number, elapsed: number) {
    this.current.update(delta, elapsed);
    if (!this.incoming) return;

    this.incoming.update(delta, elapsed);
    this.transition.update(delta);

    if (this.hits >= this.transition.steps && this.transition.done) {
      this.current.dispose();
      this.current = this.incoming;
      this.current.enter();
      this.incoming = null;
      this.hits = 0;
      this.displayNode.value = this.current.output.texture;
    }
  }

  render(renderer: WebGPURenderer) {
    this.current.render(renderer);
    this.incoming?.render(renderer);

    if (this.incoming) this.transition.render(renderer);
    else this.displayQuad.render(renderer);
  }

  private mountPage(index: number) {
    const page = this.factories[index]();
    page.mount(this.ctx);
    page.nextButton.textContent = NEXT_LABELS[0];
    page.nextButton.addEventListener("click", () => this.onNext(page));
    return page;
  }
}
