import type { Texture, Vector2, WebGPURenderer } from "three/webgpu";

export type TransitionStart = {
  from: Texture; // sortie de la page qui s'en va
  to: Texture; // sortie de la page qui arrive
  origin: Vector2; // point de départ de l'effet, repère screenUV (ex. le bouton Suivant)
};

// Une transition ne connaît pas les pages : seulement deux textures et un point d'origine.
// C'est ce qui permet de l'appliquer entre n'importe quelles pages.
export interface Transition {
  readonly done: boolean;
  start(params: TransitionStart): void;
  update(delta: number): void;
  render(renderer: WebGPURenderer): void;
  dispose(): void;
}
