export type Support = {
  webgpu: boolean;
  requestPaint: boolean;
  updateElementGeometry: boolean;
  drawElementImage2D: boolean;
  drawElementImageToTexture: boolean;
};

export function detectSupport(): Support {
  const canvasProto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  const ctx2dProto = CanvasRenderingContext2D.prototype as unknown as Record<string, unknown>;
  const queueProto = (globalThis as unknown as { GPUQueue?: { prototype: Record<string, unknown> } }).GPUQueue
    ?.prototype;

  return {
    webgpu: "gpu" in navigator,
    requestPaint: typeof canvasProto.requestPaint === "function",
    updateElementGeometry: typeof canvasProto.updateElementGeometry === "function",
    drawElementImage2D: typeof ctx2dProto.drawElementImage === "function",
    drawElementImageToTexture: typeof queueProto?.drawElementImageToTexture === "function",
  };
}
