import { Vector2, WebGPURenderer } from "three/webgpu";
import { Pane } from "tweakpane";
import { CircleTransition } from "../transitions/circle";
import { HtmlTexture } from "./HtmlTexture";
import { PageManager, type PageFactory } from "./PageManager";
import { Pointer } from "./Pointer";
import { detectSupport, type Support } from "./support";

export type AppContext = {
  renderer: WebGPURenderer;
  canvas: HTMLCanvasElement;
  pane: Pane;
  pointer: Pointer;
  createHtmlTexture(element: HTMLElement): HtmlTexture;
};

// La boucle est pilotée par l'événement `paint` du canvas (et pas par requestAnimationFrame) :
// c'est le seul moment où le snapshot du DOM est à jour. On copie le DOM dans les textures,
// on rend la frame, puis requestPaint() redemande un `paint` pour la frame suivante.
export class App {
  private canvas: HTMLCanvasElement;
  private pageFactories: PageFactory[];
  private nextButton: HTMLButtonElement;
  private renderer: WebGPURenderer;
  private pane = new Pane({ title: "Debug" });
  private pointer = new Pointer();
  private htmlTextures = new Set<HtmlTexture>();
  private pages: PageManager | null = null;
  private lastTime = performance.now();
  private elapsed = 0;
  private stats = { status: "init…", paints: 0, copies: 0, lastError: "" };

  constructor(canvas: HTMLCanvasElement, nextButton: HTMLButtonElement, pageFactories: PageFactory[]) {
    this.canvas = canvas;
    this.nextButton = nextButton;
    this.pageFactories = pageFactories;
    this.renderer = new WebGPURenderer({ canvas, antialias: false });
    this.init();
  }

  private async init() {
    const support = detectSupport();
    this.addMonitors(support);

    if (!support.webgpu || !support.requestPaint || !support.drawElementImageToTexture) {
      this.stats.status = "API manquante (voir Support)";
      console.error("[html-in-canvas] API indisponible", support);
      return;
    }

    await this.renderer.init();
    if (!(this.renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend) {
      this.stats.status = "three est retombé sur WebGL";
      return;
    }

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.resize();
    window.addEventListener("resize", () => this.resize());

    const ctx: AppContext = {
      renderer: this.renderer,
      canvas: this.canvas,
      pane: this.pane,
      pointer: this.pointer,
      createHtmlTexture: (element) => {
        const html = new HtmlTexture(this.renderer, this.canvas, element);
        html.onDispose = () => this.htmlTextures.delete(html);
        this.htmlTextures.add(html);
        return html;
      },
    };

    const transition = new CircleTransition(this.pane.addFolder({ title: "transition" }));
    this.pages = new PageManager(ctx, this.pageFactories, transition);

    // La transition part du centre du bouton.
    this.nextButton.addEventListener("click", () => {
      const rect = this.nextButton.getBoundingClientRect();
      const origin = new Vector2(
        (rect.left + rect.width / 2) / window.innerWidth,
        (rect.top + rect.height / 2) / window.innerHeight,
      );
      this.pages?.next(origin);
    });

    this.canvas.addEventListener("paint", (event) => this.frame(event as CanvasPaintEvent));
    this.canvas.requestPaint!();
    this.stats.status = "ok";
  }

  private resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.pages?.resize();
  }

  private frame(event: CanvasPaintEvent) {
    const now = performance.now();
    const delta = (now - this.lastTime) / 1000;
    this.lastTime = now;
    this.elapsed += delta;
    this.stats.paints++;

    const changed = event.changedElements ?? [];
    this.stats.copies = 0;
    this.stats.lastError = "";
    for (const html of this.htmlTextures) {
      html.sync(changed);
      this.stats.copies += html.copies;
      this.stats.lastError ||= html.lastError;
    }

    if (this.pages) {
      this.pages.update(delta, this.elapsed);
      this.pages.render(this.renderer);
      this.nextButton.disabled = this.pages.transitioning;
    }

    this.canvas.requestPaint!();
  }

  private addMonitors(support: Support) {
    const supportFolder = this.pane.addFolder({ title: "Support", expanded: false });
    for (const key of Object.keys(support) as (keyof Support)[]) {
      supportFolder.addBinding(support, key, { readonly: true });
    }

    const statsFolder = this.pane.addFolder({ title: "Stats" });
    statsFolder.addBinding(this.stats, "status", { readonly: true });
    statsFolder.addBinding(this.stats, "paints", { readonly: true, format: (v) => v.toFixed(0) });
    statsFolder.addBinding(this.stats, "copies", { readonly: true, format: (v) => v.toFixed(0) });
    statsFolder.addBinding(this.stats, "lastError", { readonly: true, multiline: true, rows: 3 });
  }
}
