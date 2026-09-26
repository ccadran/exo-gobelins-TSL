import type { Texture, Vector2, WebGPURenderer } from "three/webgpu";

export type TransitionStart = {
  from: Texture;
  to: Texture;
  origin: Vector2;
};

export interface Transition {
  readonly steps: number;
  readonly done: boolean;
  start(params: TransitionStart): void;
  hit(): void;
  cancel(): void;
  update(delta: number): void;
  render(renderer: WebGPURenderer): void;
  dispose(): void;
}
