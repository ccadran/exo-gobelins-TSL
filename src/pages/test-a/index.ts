import { MeshBasicNodeMaterial, QuadMesh, type WebGPURenderer } from "three/webgpu";
import { exp, screenUV, texture, uniform, vec4 } from "three/tsl";
import type { AppContext } from "../../core/App";
import { Page } from "../Page";
import template from "./template.html?raw";
import style from "./style.css?inline";

// Page de test A : aberration chromatique, plus forte près du curseur.
export class TestAPage extends Page {
  readonly id = "test-a";
  protected readonly template = template;
  protected readonly style = style;

  private material = new MeshBasicNodeMaterial();
  private quad = new QuadMesh(this.material);

  protected setup(ctx: AppContext) {
    const amount = uniform(0.03);
    const radius = uniform(4);

    const toPointer = screenUV.sub(ctx.pointer.uv);
    const offset = toPointer.mul(amount).mul(exp(toPointer.length().mul(radius).negate()));

    const r = texture(this.html.texture, screenUV.add(offset)).r;
    const g = texture(this.html.texture, screenUV).g;
    const b = texture(this.html.texture, screenUV.sub(offset)).b;
    this.material.colorNode = vec4(r, g, b, 1);

    this.debug.addBinding(amount, "value", { label: "amount", min: 0, max: 0.2 });
    this.debug.addBinding(radius, "value", { label: "radius", min: 0, max: 20 });

    const counter = this.root.querySelector(".counter span")!;
    let clicks = 0;
    this.root.querySelector(".counter")!.addEventListener("click", () => {
      counter.textContent = String(++clicks);
    });
  }

  protected draw(renderer: WebGPURenderer) {
    this.quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    super.dispose();
  }
}
