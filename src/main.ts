import { App } from "./core/App";
import { FireWaterPage } from "./pages/fire-water";
import { RetroPage } from "./pages/retro";

const canvas = document.querySelector("canvas") as HTMLCanvasElement;

new App(canvas, {
  "fire-water": () => new FireWaterPage(),
  retro: () => new RetroPage(),
});
