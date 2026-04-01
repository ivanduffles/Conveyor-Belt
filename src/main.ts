import Phaser from "phaser";
import "./styles.css";
import { ConveyorSortGame } from "./game/simulation/gameModel";
import { GameScene } from "./phaser/scenes/GameScene";
import { createHud } from "./ui/hud";

const GAME_WIDTH = 990;
const GAME_HEIGHT = 1600;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("App root not found.");
}

app.innerHTML = `
  <div class="app-shell">
    <div class="play-surface">
      <div class="game-frame">
        <div id="game-root" class="game-root"></div>
      </div>
      <div id="hud-root" class="hud-root"></div>
    </div>
  </div>
`;

const hudRoot = document.querySelector<HTMLElement>("#hud-root");
if (!hudRoot) {
  throw new Error("HUD root not found.");
}

const hud = createHud(hudRoot);
const model = new ConveyorSortGame(GAME_WIDTH, GAME_HEIGHT);
const scene = new GameScene(model, hud);

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: "#08131e",
  scene: [scene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  }
});
