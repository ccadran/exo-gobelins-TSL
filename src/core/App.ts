import { WebGPURenderer } from "three/webgpu";
import { Pane } from "tweakpane";
import { CrackTransition } from "../transitions/crack";
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

export class App {
  private canvas: HTMLCanvasElement;
  private pageFactories: Record<string, PageFactory>;
  private renderer: WebGPURenderer;
  private pane = new Pane({ title: "Debug" });
  private pointer = new Pointer();
  private htmlTextures = new Set<HtmlTexture>();
  private pages: PageManager | null = null;
  private lastTime = performance.now();
  private elapsed = 0;
  private stats = {
    status: "init…",
    fps: 0,
    paints: 0,
    copies: 0,
    lastError: "",
  };
  private settings = {
    maxFps: 120,
    pixelRatio: Math.min(window.devicePixelRatio, 2),
  };

  constructor(
    canvas: HTMLCanvasElement,
    pageFactories: Record<string, PageFactory>,
  ) {
    this.canvas = canvas;
    this.pageFactories = pageFactories;
    this.renderer = new WebGPURenderer({ canvas, antialias: false });
    const updateDebugVisibility = () => {
      this.pane.hidden = location.hash !== "#debug";
    };
    updateDebugVisibility();
    window.addEventListener("hashchange", updateDebugVisibility);
    this.init();
  }

  private async init() {
    const support = detectSupport();
    this.addMonitors(support);

    if (
      !support.webgpu ||
      !support.requestPaint ||
      !support.drawElementImageToTexture
    ) {
      this.stats.status = "API manquante (voir Support)";
      console.error("[html-in-canvas] API indisponible", support);
      return;
    }

    await this.renderer.init();
    if (
      !(this.renderer.backend as unknown as { isWebGPUBackend?: boolean })
        .isWebGPUBackend
    ) {
      this.stats.status = "three est retombé sur WebGL";
      return;
    }

    this.renderer.setPixelRatio(this.settings.pixelRatio);
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

    const transition = new CrackTransition(
      this.pane.addFolder({ title: "transition" }),
      this.pointer,
    );
    this.pages = new PageManager(
      ctx,
      Object.values(this.pageFactories),
      transition,
    );

    const navigation = this.pane.addFolder({ title: "pages" });
    Object.keys(this.pageFactories).forEach((name, index) => {
      navigation
        .addButton({ title: name })
        .on("click", () => this.pages?.goTo(index));
    });

    this.canvas.addEventListener("paint", (event) =>
      this.frame(event as CanvasPaintEvent),
    );
    this.canvas.requestPaint!();
    this.stats.status = "ok";
  }

  private resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.pages?.resize();
  }

  private frame(event: CanvasPaintEvent) {
    this.stats.paints++;

    const changed = event.changedElements ?? [];
    this.stats.copies = 0;
    this.stats.lastError = "";
    for (const html of this.htmlTextures) {
      html.sync(changed);
      this.stats.copies += html.copies;
      this.stats.lastError ||= html.lastError;
    }

    const now = performance.now();
    if (now - this.lastTime < 1000 / this.settings.maxFps - 2) {
      this.canvas.requestPaint!();
      return;
    }
    const delta = (now - this.lastTime) / 1000;
    this.lastTime = now;
    this.elapsed += delta;
    this.stats.fps += (1 / Math.max(delta, 1e-3) - this.stats.fps) * 0.1;

    if (this.pages) {
      this.pages.update(delta, this.elapsed);
      this.pages.render(this.renderer);
    }

    this.canvas.requestPaint!();
  }

  private addMonitors(support: Support) {
    const supportFolder = this.pane.addFolder({
      title: "Support",
      expanded: false,
    });
    for (const key of Object.keys(support) as (keyof Support)[]) {
      supportFolder.addBinding(support, key, { readonly: true });
    }

    const statsFolder = this.pane.addFolder({ title: "Stats" });
    statsFolder.addBinding(this.stats, "status", { readonly: true });
    statsFolder.addBinding(this.stats, "fps", {
      readonly: true,
      format: (v) => v.toFixed(0),
    });
    statsFolder.addBinding(this.stats, "paints", {
      readonly: true,
      format: (v) => v.toFixed(0),
    });
    statsFolder.addBinding(this.stats, "copies", {
      readonly: true,
      format: (v) => v.toFixed(0),
    });
    statsFolder.addBinding(this.stats, "lastError", {
      readonly: true,
      multiline: true,
      rows: 3,
    });

    const performanceFolder = this.pane.addFolder({ title: "Performance" });
    performanceFolder.addBinding(this.settings, "maxFps", {
      label: "fps max",
      options: { "30": 30, "60": 60, "120": 120 },
    });
    performanceFolder
      .addBinding(this.settings, "pixelRatio", {
        label: "résolution",
        min: 0.5,
        max: 2,
        step: 0.25,
      })
      .on("change", () => {
        this.renderer.setPixelRatio(this.settings.pixelRatio);
        this.resize();
        for (const html of this.htmlTextures) html.resize();
      });
  }
}
