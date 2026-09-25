import type { Texture, Vector2, WebGPURenderer } from "three/webgpu";

export type TransitionStart = {
  from: Texture; // sortie de la page qui s'en va
  to: Texture; // sortie de la page qui arrive
  origin: Vector2; // point de départ de l'effet, repère screenUV (le bouton Suivant)
};

// Une transition ne connaît pas les pages : seulement deux textures et un point d'origine.
// C'est ce qui permet de l'appliquer entre n'importe quelles pages.
//
// Déroulé, piloté par le PageManager :
// 1er clic sur le bouton : start() puis hit() ; clics suivants : hit().
// Au `steps`-ième clic, la transition part pour de bon ; quand `done` passe à vrai,
// le PageManager remplace la page.
export interface Transition {
  readonly steps: number; // nombre de clics pour passer à la page suivante
  readonly done: boolean;
  start(params: TransitionStart): void;
  hit(): void;
  cancel(): void; // abandon en cours de route (ex. navigation directe depuis le debug)
  update(delta: number): void;
  render(renderer: WebGPURenderer): void;
  dispose(): void;
}
