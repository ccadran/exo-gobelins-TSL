import { App } from "./core/App";
import { FireWaterPage } from "./pages/fire-water";
import { RetroPage } from "./pages/retro";

const canvas = document.querySelector("canvas") as HTMLCanvasElement;

// L'ordre des clés = l'ordre du parcours. Les noms apparaissent dans le debug (dossier "pages").
new App(canvas, {
  "fire-water": () => new FireWaterPage(),
  retro: () => new RetroPage(),
});
