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
    <div class="hud-topbar">
      <div class="hud-side-stat">
        <span>Mistakes</span>
        <strong data-role="mistakes">0</strong>
      </div>
      <div class="hud-score-wrap">
        <span class="hud-score-label">Score</span>
        <strong class="hud-score" data-role="score">0</strong>
      </div>
      <div class="hud-side-stat hud-side-stat-right">
        <span>Streak</span>
        <strong data-role="streak">0</strong>
      </div>
    </div>
    <div class="hud-banner is-neutral" data-role="banner">Sort by suit before the belt outruns you.</div>
  `;

  const score = root.querySelector<HTMLElement>('[data-role="score"]');
  const mistakes = root.querySelector<HTMLElement>('[data-role="mistakes"]');
  const streak = root.querySelector<HTMLElement>('[data-role="streak"]');
  const banner = root.querySelector<HTMLElement>('[data-role="banner"]');

  if (!score || !mistakes || !streak || !banner) {
    throw new Error("HUD nodes could not be created.");
  }

  return {
    render(snapshot: GameSnapshot): void {
      score.textContent = snapshot.score.toString();
      mistakes.textContent = snapshot.mistakes.toString();
      streak.textContent = snapshot.streak.toString();
      banner.textContent = `Belt Speed ${snapshot.difficulty.toFixed(2)}x`;
      banner.className = `hud-banner ${BANNER_CLASS_BY_TONE.neutral}`;
    }
  };
}
