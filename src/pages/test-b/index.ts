import { MeshBasicNodeMaterial, QuadMesh, type WebGPURenderer } from "three/webgpu";
import { floor, mix, screenSize, screenUV, texture, uniform } from "three/tsl";
import type { AppContext } from "../../core/App";
import { Page } from "../Page";
import template from "./template.html?raw";
import style from "./style.css?inline";

export class TestBPage extends Page {
  readonly id = "test-b";
  protected readonly template = template;
  protected readonly style = style;

  private material = new MeshBasicNodeMaterial();
  private quad = new QuadMesh(this.material);

  protected setup(ctx: AppContext) {
    const maxPixelSize = uniform(48);

    const pixelSize = mix(1, maxPixelSize, ctx.pointer.uv.x);
    const cells = screenSize.div(pixelSize);
    const pixelatedUV = floor(screenUV.mul(cells)).add(0.5).div(cells);
    this.material.colorNode = texture(this.html.texture, pixelatedUV);

    this.debug.addBinding(maxPixelSize, "value", { label: "max pixel", min: 1, max: 128 });

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
