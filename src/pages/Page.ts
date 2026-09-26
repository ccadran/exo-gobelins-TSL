import { HalfFloatType, RenderTarget, Vector2, type WebGPURenderer } from "three/webgpu";
import type { FolderApi } from "tweakpane";
import type { AppContext } from "../core/App";
import type { HtmlTexture } from "../core/HtmlTexture";

const size = new Vector2();

export abstract class Page {
  abstract readonly id: string;
  protected abstract readonly template: string;
  protected abstract readonly style: string;

  root!: HTMLElement;
  nextButton!: HTMLButtonElement;
  readonly output = new RenderTarget(1, 1, { type: HalfFloatType });
  protected html!: HtmlTexture;
  protected debug!: FolderApi;
  private styleElement?: HTMLStyleElement;

  get ready() {
    return this.html.copies > 0;
  }

  mount(ctx: AppContext) {
    this.root = document.createElement("section");
    this.root.setAttribute("drawable", "");
    this.root.dataset.page = this.id;
    this.root.className = "page";
    this.root.innerHTML = this.template;
    this.nextButton = document.createElement("button");
    this.nextButton.type = "button";
    this.nextButton.className = "next-button";
    this.root.append(this.nextButton);
    ctx.canvas.append(this.root);

    this.styleElement = document.createElement("style");
    this.styleElement.textContent = this.style;
    document.head.append(this.styleElement);

    this.html = ctx.createHtmlTexture(this.root);
    this.debug = ctx.pane.addFolder({ title: this.id });
    this.resize(ctx.renderer);
    this.setup(ctx);
  }

  protected abstract setup(ctx: AppContext): void;

  resize(renderer: WebGPURenderer) {
    renderer.getDrawingBufferSize(size);
    this.output.setSize(size.x, size.y);
  }

  update(_delta: number, _elapsed: number) {}

  render(renderer: WebGPURenderer) {
    renderer.setRenderTarget(this.output);
    this.draw(renderer);
    renderer.setRenderTarget(null);
  }

  protected abstract draw(renderer: WebGPURenderer): void;

  enter() {
    this.root.inert = false;
  }

  leave() {
    this.root.inert = true;
  }

  dispose() {
    this.html.dispose();
    this.debug.dispose();
    this.output.dispose();
    this.root.remove();
    this.styleElement?.remove();
  }
}
