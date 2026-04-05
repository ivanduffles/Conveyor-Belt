import type { BannerTone, GameSnapshot } from "../game/simulation/gameModel";

export interface HudController {
  render(snapshot: GameSnapshot): void;
}

const BANNER_CLASS_BY_TONE: Record<BannerTone, string> = {
  good: "is-good",
  warn: "is-warn",
  bad: "is-bad",
  neutral: "is-neutral"
};

export function createHud(root: HTMLElement): HudController {
  root.innerHTML = `
    <div class="hud-score-wrap">
      <span class="hud-score-label">Score</span>
      <strong class="hud-score" data-role="score">0</strong>
    </div>
    <div class="hud-stats">
      <div class="hud-side-stat">
        <span>Mistakes</span>
        <strong data-role="mistakes">0</strong>
      </div>
      <div class="hud-side-stat">
        <span>Streak</span>
        <strong data-role="streak">0</strong>
      </div>
      <div class="hud-side-stat">
        <span>Belt Speed</span>
        <strong data-role="speed">1.00x</strong>
      </div>
    </div>
    <!--
    <div class="hud-banner is-neutral" data-role="banner">Sort only the two target suits. Ignore the others.</div>
    -->
  `;

  const score = root.querySelector<HTMLElement>('[data-role="score"]');
  const mistakes = root.querySelector<HTMLElement>('[data-role="mistakes"]');
  const streak = root.querySelector<HTMLElement>('[data-role="streak"]');
  const speed = root.querySelector<HTMLElement>('[data-role="speed"]');
  // const banner = root.querySelector<HTMLElement>('[data-role="banner"]');

  if (!score || !mistakes || !streak || !speed) {
    throw new Error("HUD nodes could not be created.");
  }

  return {
    render(snapshot: GameSnapshot): void {
      score.textContent = snapshot.score.toString();
      mistakes.textContent = snapshot.mistakes.toString();
      streak.textContent = snapshot.streak.toString();
      speed.textContent = `${snapshot.difficulty.toFixed(2)}x`;

      /*
      if (banner) {
        banner.textContent = snapshot.bannerText ?? "Sort only the two target suits. Ignore the others.";
        banner.className = `hud-banner ${BANNER_CLASS_BY_TONE[snapshot.bannerTone]}`;
      }
      */
      void BANNER_CLASS_BY_TONE;
    }
  };
}
