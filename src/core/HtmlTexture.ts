import { ExternalTexture, SRGBColorSpace, type WebGPURenderer } from "three/webgpu";

// Pont DOM -> texture three.js.
// On crée nous-mêmes la GPUTexture avec le device de three, et on la donne à three
// via ExternalTexture (three l'utilise telle quelle sans la recréer).
// La copie du rendu HTML se fait avec queue.drawElementImageToTexture, dans l'événement `paint`.
// Dans un matériau : `texture(html.texture, uv)`. L'objet reste le même après un resize.

export class HtmlTexture {
  readonly texture = new ExternalTexture();

  copies = 0;
  lastError = "";
  onDispose?: () => void;

  private gpuTexture: GPUTexture | null = null;
  private width = 0;
  private height = 0;
  private dirty = true;
  private resizeObserver: ResizeObserver;
  private renderer: WebGPURenderer;
  private canvas: HTMLCanvasElement;
  readonly element: HTMLElement;

  constructor(renderer: WebGPURenderer, canvas: HTMLCanvasElement, element: HTMLElement) {
    this.renderer = renderer;
    this.canvas = canvas;
    this.element = element;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(element);
    this.resize();
  }

  private get device(): GPUDevice {
    // Interne de three : pas d'API publique pour récupérer le GPUDevice.
    return (this.renderer.backend as unknown as { device: GPUDevice }).device;
  }

  // Taille en "canvas grid coordinates" (pixels du canvas, donc DPR inclus).
  // Appelé automatiquement quand l'élément change de taille, et par l'App quand la
  // résolution (pixel ratio) change.
  resize() {
    const scale = this.renderer.getPixelRatio();
    const rect = this.element.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    if (width === this.width && height === this.height) return;

    this.width = width;
    this.height = height;

    const previous = this.gpuTexture;

    this.gpuTexture = this.device.createTexture({
      label: `html:${this.element.dataset.page ?? this.element.tagName}`,
      size: { width, height },
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // dispose() fait oublier à three l'ancienne GPUTexture et invalide les bind groups :
    // au prochain rendu, il reprend `sourceTexture`. Il ne détruit pas une texture externe.
    this.texture.dispose();
    this.texture.sourceTexture = this.gpuTexture;
    // Le rendu HTML est en sRGB : three le décode dans le shader.
    this.texture.colorSpace = SRGBColorSpace;
    previous?.destroy();
    this.dirty = true;
  }

  // À appeler dans le handler `paint` du canvas.
  sync(changedElements: ReadonlyArray<Element>) {
    if (!this.gpuTexture) return;
    if (!this.dirty && !changedElements.includes(this.element)) return;

    try {
      this.device.queue.drawElementImageToTexture!(
        { source: this.element },
        { texture: this.gpuTexture, size: { width: this.width, height: this.height } },
      );
      // Contexte 3D : obligatoire pour que hit-test et accessibilité suivent.
      // Page plein écran sans transformation => options par défaut.
      this.canvas.updateElementGeometry?.(this.element);
      this.dirty = false;
      this.copies++;
      this.lastError = "";
    } catch (error) {
      // Typiquement : pas encore de snapshot au premier paint. On réessaiera.
      this.lastError = String(error);
    }
  }

  dispose() {
    this.resizeObserver.disconnect();
    this.texture.dispose();
    this.gpuTexture?.destroy();
    this.gpuTexture = null;
    this.onDispose?.();
  }
}
