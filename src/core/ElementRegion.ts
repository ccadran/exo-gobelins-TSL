import { Vector2 } from "three/webgpu";
import { uniform } from "three/tsl";
import { sdRoundedBox, type Vec2 } from "../tsl/utils";

export class ElementRegion {
  readonly element: HTMLElement;
  readonly center = uniform(new Vector2());
  readonly halfSize = uniform(new Vector2());
  readonly radius = uniform(0);

  constructor(element: HTMLElement) {
    this.element = element;
  }

  update() {
    const rect = this.element.getBoundingClientRect();
    this.center.value.set(rect.left + rect.width / 2, rect.top + rect.height / 2);
    this.halfSize.value.set(rect.width / 2, rect.height / 2);
    const radius = parseFloat(getComputedStyle(this.element).borderTopLeftRadius) || 0;
    this.radius.value = Math.min(radius, rect.width / 2, rect.height / 2);
  }

  sdf(pixel: Vec2) {
    return sdRoundedBox(pixel.sub(this.center), this.halfSize, this.radius);
  }
}
