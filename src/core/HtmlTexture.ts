import { ExternalTexture, SRGBColorSpace, type WebGPURenderer } from "three/webgpu";

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
    return (this.renderer.backend as unknown as { device: GPUDevice }).device;
  }

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

    this.texture.dispose();
    this.texture.sourceTexture = this.gpuTexture;
    this.texture.colorSpace = SRGBColorSpace;
    previous?.destroy();
    this.dirty = true;
  }

  sync(changedElements: ReadonlyArray<Element>) {
    if (!this.gpuTexture) return;
    if (!this.dirty && !changedElements.includes(this.element)) return;

    try {
      this.device.queue.drawElementImageToTexture!(
        { source: this.element },
        { texture: this.gpuTexture, size: { width: this.width, height: this.height } },
      );
      this.canvas.updateElementGeometry?.(this.element);
      this.dirty = false;
      this.copies++;
      this.lastError = "";
    } catch (error) {
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
