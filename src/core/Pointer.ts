import { Vector2 } from "three/webgpu";
import { uniform } from "three/tsl";

// Position du pointeur dans le même repère que `screenUV` (0..1, origine en haut à gauche).
export class Pointer {
  readonly uv = uniform(new Vector2(0.5, 0.5));

  constructor() {
    window.addEventListener("pointermove", (event) => {
      this.uv.value.set(event.clientX / window.innerWidth, event.clientY / window.innerHeight);
    });
  }
}
