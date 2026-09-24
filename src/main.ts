import { App } from "./core/App";
import { FireWaterPage } from "./pages/fire-water";
import { TestAPage } from "./pages/test-a";
import { TestBPage } from "./pages/test-b";

const canvas = document.querySelector("canvas") as HTMLCanvasElement;
const nextButton = document.querySelector(".ui-next") as HTMLButtonElement;

// L'ordre du tableau = l'ordre du parcours.
new App(canvas, nextButton, [
  () => new FireWaterPage(),
  () => new TestAPage(),
  () => new TestBPage(),
]);
