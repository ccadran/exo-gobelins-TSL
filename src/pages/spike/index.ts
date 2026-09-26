import { MeshBasicNodeMaterial, QuadMesh, type WebGPURenderer } from "three/webgpu";
import { exp, screenSize, screenUV, sin, texture, time, uniform, vec2 } from "three/tsl";
import type { AppContext } from "../../core/App";
import { Page } from "../Page";
import template from "./template.html?raw";
import style from "./style.css?inline";

export class SpikePage extends Page {
  readonly id = "spike";
  protected readonly template = template;
  protected readonly style = style;

  private material = new MeshBasicNodeMaterial();
  private quad = new QuadMesh(this.material);

  protected setup(ctx: AppContext) {
    const amplitude = uniform(0.015);
    const frequency = uniform(40);
    const speed = uniform(4);
    const falloff = uniform(6);

    const aspect = vec2(screenSize.x.div(screenSize.y), 1);
    const toPointer = screenUV.sub(ctx.pointer.uv).mul(aspect);
    const distance = toPointer.length();
    const wave = sin(distance.mul(frequency).sub(time.mul(speed)))
      .mul(amplitude)
      .mul(exp(distance.mul(falloff).negate()));
    const offset = toPointer.div(distance.max(0.0001)).mul(wave).div(aspect);

    this.material.colorNode = texture(this.html.texture, screenUV.add(offset));

    this.debug.addBinding(amplitude, "value", { label: "amplitude", min: 0, max: 0.1 });
    this.debug.addBinding(frequency, "value", { label: "frequency", min: 1, max: 100 });
    this.debug.addBinding(speed, "value", { label: "speed", min: 0, max: 20 });
    this.debug.addBinding(falloff, "value", { label: "falloff", min: 0, max: 20 });

    const button = this.root.querySelector<HTMLButtonElement>(".button")!;
    const count = this.root.querySelector<HTMLElement>(".count")!;
    let clicks = 0;
    button.addEventListener("click", () => {
      clicks++;
      count.textContent = `${clicks} clic${clicks > 1 ? "s" : ""}`;
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
