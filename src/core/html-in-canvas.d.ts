// Types de l'API expérimentale HTML-in-Canvas (WICG), absents de lib.dom.
// Source : https://github.com/WICG/html-in-canvas (IDL de l'explainer).
// Tout est optionnel : l'API n'existe que derrière chrome://flags/#canvas-draw-element.

export {};

declare global {
  interface CanvasPaintEvent extends Event {
    readonly changedElements: ReadonlyArray<Element>;
  }

  interface HTMLCanvasElement {
    requestPaint?(): void;
    updateElementGeometry?(element: Element, options?: Record<string, unknown>): void;
    onpaint: ((this: HTMLCanvasElement, ev: CanvasPaintEvent) => unknown) | null;
  }

  interface GPUDrawElementImageSource {
    source: Element;
    sourceX?: number;
    sourceY?: number;
    sourceWidth?: number;
    sourceHeight?: number;
  }

  interface GPUDrawElementImageDestination extends GPUTexelCopyTextureInfo {
    size?: GPUExtent3D;
  }

  // Constante WebGPU présente au runtime mais absente de lib.dom.
  const GPUTextureUsage: {
    readonly COPY_SRC: number;
    readonly COPY_DST: number;
    readonly TEXTURE_BINDING: number;
    readonly STORAGE_BINDING: number;
    readonly RENDER_ATTACHMENT: number;
  };

  interface GPUQueue {
    drawElementImageToTexture?(
      source: GPUDrawElementImageSource,
      destination: GPUDrawElementImageDestination,
    ): void;
  }
}
