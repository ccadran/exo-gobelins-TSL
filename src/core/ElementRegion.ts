import { Vector2 } from "three/webgpu";
import { uniform } from "three/tsl";
import { sdRoundedBox, type Vec2 } from "../tsl/utils";

// Suit la position d'un élément du DOM (en pixels CSS) et l'expose au shader,
// pour appliquer un effet à un élément précis de la page (ex. un switch).
// Côté shader : `region.sdf(pixel)` avec `pixel = screenUV * viewport` (pixels CSS).
export class ElementRegion {
  readonly element: HTMLElement;
  readonly center = uniform(new Vector2());
  readonly halfSize = uniform(new Vector2());
  readonly radius = uniform(0);

  constructor(element: HTMLElement) {
    this.element = element;
  }

  // À appeler à chaque frame (l'élément peut bouger : resize, animation…).
  update() {
    const rect = this.element.getBoundingClientRect();
    this.center.value.set(rect.left + rect.width / 2, rect.top + rect.height / 2);
    this.halfSize.value.set(rect.width / 2, rect.height / 2);
    const radius = parseFloat(getComputedStyle(this.element).borderTopLeftRadius) || 0;
    this.radius.value = Math.min(radius, rect.width / 2, rect.height / 2);
  }

  // Distance signée en pixels CSS au bord de l'élément (négative à l'intérieur).
  sdf(pixel: Vec2) {
    return sdRoundedBox(pixel.sub(this.center), this.halfSize, this.radius);
  }
}
