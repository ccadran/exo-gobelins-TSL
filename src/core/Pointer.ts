import { Vector2 } from "three/webgpu";
import { uniform } from "three/tsl";

export class Pointer {
  readonly uv = uniform(new Vector2(0.5, 0.5));

  constructor() {
    window.addEventListener("pointermove", (event) => {
      this.uv.value.set(event.clientX / window.innerWidth, event.clientY / window.innerHeight);
    });
  }
}
