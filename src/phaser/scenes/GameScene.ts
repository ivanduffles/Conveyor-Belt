import Phaser from "phaser";
import { ConveyorSortGame, type GameEvent, type GameSnapshot, type GestureIntent, type ZoneLayout } from "../../game/simulation/gameModel";
import type { Suit } from "../../game/simulation/cards";
import { CardView } from "../view/CardView";
import type { HudController } from "../../ui/hud";

const SUIT_SYMBOLS: Record<Suit, string> = {
  hearts: "\u2665",
  diamonds: "\u2666",
  clubs: "\u2663",
  spades: "\u2660"
};

const SUIT_DISPLAY_COLORS: Record<Suit, string> = {
  hearts: "#d12b3f",
  diamonds: "#d12b3f",
  clubs: "#101010",
  spades: "#101010"
};

interface ZoneVisual {
  zone: ZoneLayout;
  glow: Phaser.GameObjects.Rectangle;
  body: Phaser.GameObjects.Rectangle;
  halo: Phaser.GameObjects.Text;
}

interface ScreenGestureState {
  pointerId: number;
  downPoint: {
    x: number;
    y: number;
  };
}

export class GameScene extends Phaser.Scene {
  private static readonly MIN_SWIPE_DISTANCE = 72;
  private static readonly DIRECTION_CONFIDENCE_RATIO = 1.2;

  private readonly model: ConveyorSortGame;
  private readonly hud: HudController;

  private backdrop!: Phaser.GameObjects.Graphics;
  private beltFx!: Phaser.GameObjects.Graphics;
  private zoneVisuals = new Map<string, ZoneVisual>();
  private cardViews = new Map<number, CardView>();
  private activeGesture: ScreenGestureState | null = null;
  private matchTime = 0;
  private previewIntent: GestureIntent | null = null;

  constructor(model: ConveyorSortGame, hud: HudController) {
    super("conveyor-sort");
    this.model = model;
    this.hud = hud;
  }

  create(): void {
    this.model.reset();
    this.matchTime = 0;
    this.cardViews.clear();
    this.zoneVisuals.clear();
    this.activeGesture = null;
    this.previewIntent = null;

    this.cameras.main.setBackgroundColor("#1d5a34");
    this.input.setTopOnly(true);
    this.input.addPointer(2);

    this.backdrop = this.add.graphics().setDepth(0);
    this.beltFx = this.add.graphics().setDepth(10);
    this.drawBackdrop();

    const initial = this.model.getSnapshot();
    this.createBeltHardware(initial);
    this.createZones(initial.zones);

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.activeGesture) {
        return;
      }

      const lockedCardId = this.model.startFrontCardGesture({ x: pointer.worldX, y: pointer.worldY });
      if (lockedCardId === null) {
        return;
      }

      this.activeGesture = {
        pointerId: pointer.id,
        downPoint: { x: pointer.worldX, y: pointer.worldY }
      };
      this.previewIntent = null;
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!this.activeGesture || this.activeGesture.pointerId !== pointer.id) {
        return;
      }

      this.previewIntent = this.classifyGestureIntent(this.activeGesture.downPoint, { x: pointer.worldX, y: pointer.worldY });
      this.model.moveActiveGesture({ x: pointer.worldX, y: pointer.worldY });
    });

    const finalizeGesture = (pointer: Phaser.Input.Pointer): void => {
      if (!this.activeGesture || this.activeGesture.pointerId !== pointer.id) {
        return;
      }

      const intent = this.classifyGestureIntent(this.activeGesture.downPoint, { x: pointer.worldX, y: pointer.worldY });
      this.model.resolveActiveGesture(intent);
      this.activeGesture = null;
      this.previewIntent = null;
    };

    this.input.on("pointerup", finalizeGesture);
    this.input.on("pointerupoutside", finalizeGesture);

    this.input.keyboard?.on("keydown-R", () => {
      this.scene.restart();
    });
  }

  update(_time: number, delta: number): void {
    const deltaSeconds = delta / 1000;
    this.matchTime += deltaSeconds;
    this.model.update(deltaSeconds);

    const events = this.model.drainEvents();
    for (const event of events) {
      this.handleEvent(event);
    }

    const snapshot = this.model.getSnapshot();
    this.drawBelt(snapshot);
    this.syncZones(snapshot);
    this.syncCards(snapshot);
    this.hud.render(snapshot);
  }

  private drawBackdrop(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const inset = 28;

    this.backdrop.clear();
    this.backdrop.fillGradientStyle(0x1d5a34, 0x24643b, 0x1f5b35, 0x17482a, 1);
    this.backdrop.fillRect(0, 0, width, height);
    this.backdrop.fillStyle(0x1f6a3d, 0.92);
    this.backdrop.fillRoundedRect(inset, inset, width - inset * 2, height - inset * 2, 34);
    this.backdrop.lineStyle(2, 0xa9d1b2, 0.22);
    this.backdrop.strokeRoundedRect(inset, inset, width - inset * 2, height - inset * 2, 34);
    this.backdrop.fillStyle(0x154327, 0.3);
    this.backdrop.fillCircle(width * 0.83, height * 0.14, 132);
    this.backdrop.fillCircle(width * 0.2, height * 0.86, 156);
    this.backdrop.fillCircle(width * 0.5, height * 0.5, 230);
    this.backdrop.lineStyle(1, 0xffffff, 0.05);
    for (let y = inset + 18; y < height - inset; y += 22) {
      this.backdrop.strokeLineShape(new Phaser.Geom.Line(inset + 10, y, width - inset - 10, y));
    }
  }

  private createBeltHardware(snapshot: GameSnapshot): void {
    this.add.ellipse(snapshot.beltStart.x, snapshot.beltStart.y - 8, snapshot.beltWidth + 42, 152, 0x31424f, 0.94)
      .setDepth(18)
      .setStrokeStyle(8, 0x5d7687, 0.8);

    this.add.ellipse(snapshot.beltStart.x, snapshot.beltStart.y - 16, snapshot.beltWidth - 8, 108, 0x060b11, 1)
      .setDepth(19)
      .setStrokeStyle(2, 0x6fc5ff, 0.16);

    this.add.rectangle(snapshot.beltEnd.x, snapshot.beltEnd.y + 20, snapshot.beltWidth + 50, 72, 0x280d12, 0.9)
      .setDepth(18)
      .setStrokeStyle(6, 0x6e2633, 0.8);

    this.add.rectangle(snapshot.beltEnd.x, snapshot.beltEnd.y + 20, snapshot.beltWidth - 24, 38, 0x070b10, 1)
      .setDepth(19)
      .setStrokeStyle(2, 0xef8c9c, 0.16);
  }

  private createZones(zones: ZoneLayout[]): void {
    for (const zone of zones) {
      const visibleWidth = zone.width * 0.78;
      const visibleHeight = zone.height * 0.72;
      const glow = this.add.rectangle(zone.center.x, zone.center.y, visibleWidth + 34, visibleHeight + 34, zone.accent, 0.1).setDepth(40);
      const body = this.add.rectangle(zone.center.x, zone.center.y, visibleWidth, visibleHeight, 0x103723, 0.78).setDepth(41);
      body.setStrokeStyle(4, zone.accent, 0.72);

      const halo = this.add.text(zone.center.x, zone.center.y - 4, SUIT_SYMBOLS[zone.suit], {
        color: SUIT_DISPLAY_COLORS[zone.suit],
        fontFamily: "Georgia, serif",
        fontSize: "136px",
        fontStyle: "bold"
      }).setOrigin(0.5).setDepth(42).setAlpha(0.94);

      this.zoneVisuals.set(zone.id, { zone, glow, body, halo });
    }
  }

  private drawBelt(snapshot: GameSnapshot): void {
    this.beltFx.clear();

    const dx = snapshot.beltEnd.x - snapshot.beltStart.x;
    const dy = snapshot.beltEnd.y - snapshot.beltStart.y;
    const length = Math.hypot(dx, dy);
    const nx = -dy / length;
    const ny = dx / length;
    const halfWidth = snapshot.beltWidth / 2;

    const a = { x: snapshot.beltStart.x + nx * halfWidth, y: snapshot.beltStart.y + ny * halfWidth };
    const b = { x: snapshot.beltStart.x - nx * halfWidth, y: snapshot.beltStart.y - ny * halfWidth };
    const c = { x: snapshot.beltEnd.x - nx * halfWidth, y: snapshot.beltEnd.y - ny * halfWidth };
    const d = { x: snapshot.beltEnd.x + nx * halfWidth, y: snapshot.beltEnd.y + ny * halfWidth };

    this.beltFx.fillStyle(0x1b2a34, 0.98);
    this.beltFx.beginPath();
    this.beltFx.moveTo(a.x, a.y);
    this.beltFx.lineTo(b.x, b.y);
    this.beltFx.lineTo(c.x, c.y);
    this.beltFx.lineTo(d.x, d.y);
    this.beltFx.closePath();
    this.beltFx.fillPath();

    this.beltFx.lineStyle(7, 0x506273, 0.74);
    this.beltFx.strokeLineShape(new Phaser.Geom.Line(a.x, a.y, d.x, d.y));
    this.beltFx.strokeLineShape(new Phaser.Geom.Line(b.x, b.y, c.x, c.y));

    const slatSpacing = 58;
    const travel = (this.matchTime * snapshot.beltPixelsPerSecond * 0.9) % slatSpacing;

    this.beltFx.lineStyle(9, 0x7d8b94, 0.54);
    for (let distance = travel - slatSpacing; distance < length + slatSpacing; distance += slatSpacing) {
      const t = Phaser.Math.Clamp(distance / length, 0, 1);
      const cx = snapshot.beltStart.x + dx * t;
      const cy = snapshot.beltStart.y + dy * t;
      const reach = snapshot.beltWidth * 0.72;
      const x1 = cx + nx * reach * 0.5;
      const y1 = cy + ny * reach * 0.5;
      const x2 = cx - nx * reach * 0.5;
      const y2 = cy - ny * reach * 0.5;
      this.beltFx.strokeLineShape(new Phaser.Geom.Line(x1, y1, x2, y2));
    }

    this.beltFx.fillStyle(0x4a1018, 0.55);
    this.beltFx.fillCircle(snapshot.beltEnd.x, snapshot.beltEnd.y + 20, 24);
  }

  private syncZones(snapshot: GameSnapshot): void {
    for (const zone of snapshot.zones) {
      const visual = this.zoneVisuals.get(zone.id);
      if (!visual) {
        continue;
      }
      const matchesSuit = snapshot.activeDragSuit === zone.suit;
      const matchesGesture = this.previewIntent === zone.id;
      const isHighlighted = matchesSuit || matchesGesture;
      visual.glow.setAlpha(matchesGesture ? 0.32 : matchesSuit ? 0.26 : 0.1);
      visual.halo.setAlpha(isHighlighted ? 1 : 0.94);
      visual.body.setScale(matchesGesture ? 1.05 : matchesSuit ? 1.035 : 1);
      visual.body.setFillStyle(isHighlighted ? 0x15592f : 0x103723, isHighlighted ? 0.88 : 0.78);
    }
  }

  private syncCards(snapshot: GameSnapshot): void {
    const activeIds = new Set(snapshot.cards.map((card) => card.id));

    for (const card of snapshot.cards) {
      const existing = this.cardViews.get(card.id);
      if (existing) {
        existing.refresh(card);
        continue;
      }

      const view = new CardView(this, card);
      this.cardViews.set(card.id, view);
    }

    for (const [cardId, view] of this.cardViews.entries()) {
      if (!activeIds.has(cardId)) {
        this.cardViews.delete(cardId);
        view.destroy();
      }
    }
  }

  private handleEvent(event: GameEvent): void {
    const view = this.cardViews.get(event.cardId);
    if (view) {
      this.cardViews.delete(event.cardId);
      view.disableInteractive();
    }

    if (event.zoneId) {
      const zone = this.zoneVisuals.get(event.zoneId);
      if (zone) {
        const color = event.type === "sorted" ? 0xffffff : 0xff647b;
        zone.glow.setFillStyle(color, event.type === "sorted" ? 0.18 : 0.28);
        zone.body.setStrokeStyle(4, color, 0.85);
        this.tweens.add({
          targets: [zone.glow, zone.halo],
          alpha: 0.44,
          duration: 110,
          yoyo: true,
          onComplete: () => {
            zone.glow.setFillStyle(zone.zone.accent, 0.1);
            zone.body.setStrokeStyle(4, zone.zone.accent, 0.72);
          }
        });
      }
    }

    if (view) {
      const destination = event.worldPoint;
      const scale = event.type === "sorted" ? 0.72 : event.type === "trash" ? 0.82 : 0.9;
      const angle = event.type === "mistake" ? 18 : 0;
      const offsetY = event.type === "miss" || event.type === "trash" ? 54 : 0;

      this.tweens.add({
        targets: view,
        x: destination.x,
        y: destination.y + offsetY,
        alpha: 0,
        scaleX: scale,
        scaleY: scale,
        angle,
        duration: 180,
        ease: "Cubic.easeIn",
        onComplete: () => view.destroy()
      });
    }

    if (event.type === "trash" || event.scoreDelta === 0) {
      return;
    }

    const label = event.scoreDelta > 0 ? `+${event.scoreDelta}` : `${event.scoreDelta}`;
    const color = event.scoreDelta > 0 ? "#9df2b2" : "#ff8fa1";
    const scoreText = this.add.text(event.worldPoint.x, event.worldPoint.y - 18, label, {
      color,
      fontFamily: "Trebuchet MS, sans-serif",
      fontSize: "28px",
      fontStyle: "bold"
    }).setOrigin(0.5).setDepth(5000);

    this.tweens.add({
      targets: scoreText,
      y: scoreText.y - 32,
      alpha: 0,
      duration: 420,
      ease: "Sine.easeOut",
      onComplete: () => scoreText.destroy()
    });
  }

  private classifyGestureIntent(
    from: { x: number; y: number },
    to: { x: number; y: number }
  ): GestureIntent {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance < GameScene.MIN_SWIPE_DISTANCE) {
      return "none";
    }

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const angleDegrees = Phaser.Math.RadToDeg(Math.atan2(dy, dx));

    if (absDx >= absDy * GameScene.DIRECTION_CONFIDENCE_RATIO) {
      return angleDegrees > 90 || angleDegrees < -90 ? "west" : "east";
    }

    if (absDy >= absDx * GameScene.DIRECTION_CONFIDENCE_RATIO) {
      return "trash";
    }

    return "none";
  }
}
