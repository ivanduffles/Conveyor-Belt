import Phaser from "phaser";
import { ConveyorSortGame, type GameEvent, type GameSnapshot, type ZoneLayout } from "../../game/simulation/gameModel";
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
  label: Phaser.GameObjects.Text;
  suit: Phaser.GameObjects.Text;
}

export class GameScene extends Phaser.Scene {
  private readonly model: ConveyorSortGame;
  private readonly hud: HudController;

  private backdrop!: Phaser.GameObjects.Graphics;
  private beltFx!: Phaser.GameObjects.Graphics;
  private zoneVisuals = new Map<string, ZoneVisual>();
  private cardViews = new Map<number, CardView>();
  private matchTime = 0;

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

    this.cameras.main.setBackgroundColor("#1d5a34");
    this.input.setTopOnly(true);
    this.input.dragDistanceThreshold = 0;
    this.input.dragTimeThreshold = 0;
    this.input.addPointer(2);

    this.backdrop = this.add.graphics().setDepth(0);
    this.beltFx = this.add.graphics().setDepth(10);
    this.drawBackdrop();

    const initial = this.model.getSnapshot();
    this.createTunnel(initial);
    this.createZones(initial.zones);

    this.input.on("dragstart", (_pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.GameObject) => {
      if (!(gameObject instanceof CardView)) {
        return;
      }
      this.model.startDrag(gameObject.cardId, { x: gameObject.x, y: gameObject.y });
    });

    this.input.on(
      "drag",
      (pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.GameObject) => {
        if (!(gameObject instanceof CardView)) {
          return;
        }
        this.model.moveDrag(gameObject.cardId, { x: pointer.worldX, y: pointer.worldY });
      }
    );

    this.input.on(
      "dragend",
      (pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.GameObject) => {
        if (!(gameObject instanceof CardView)) {
          return;
        }
        this.model.endDrag(gameObject.cardId, { x: pointer.worldX, y: pointer.worldY });
      }
    );

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

  private createTunnel(snapshot: GameSnapshot): void {
    this.add.ellipse(snapshot.beltStart.x + 12, snapshot.beltStart.y + 4, 164, 104, 0x31424f, 0.92)
      .setAngle(146)
      .setDepth(18)
      .setStrokeStyle(8, 0x5d7687, 0.8);

    this.add.ellipse(snapshot.beltStart.x + 4, snapshot.beltStart.y + 2, 118, 64, 0x060b11, 1)
      .setAngle(146)
      .setDepth(19)
      .setStrokeStyle(2, 0x6fc5ff, 0.14);

    this.add.text(snapshot.beltStart.x - 62, snapshot.beltStart.y - 78, "FEEDER", {
      color: "#ffffff",
      fontFamily: "Trebuchet MS, sans-serif",
      fontSize: "18px",
      fontStyle: "bold"
    }).setDepth(19).setAlpha(0.92);
  }

  private createZones(zones: ZoneLayout[]): void {
    for (const zone of zones) {
      const glow = this.add.rectangle(zone.center.x, zone.center.y, zone.width + 34, zone.height + 34, 0xffffff, 0.06).setDepth(40);
      const body = this.add.rectangle(zone.center.x, zone.center.y, zone.width, zone.height, 0x0e3d23, 0.72).setDepth(41);
      body.setStrokeStyle(3, 0xe9f4ea, 0.5);

      const halo = this.add.text(zone.center.x, zone.center.y - 22, SUIT_SYMBOLS[zone.suit], {
        color: SUIT_DISPLAY_COLORS[zone.suit],
        fontFamily: "Georgia, serif",
        fontSize: "112px",
        fontStyle: "bold"
      }).setOrigin(0.5).setDepth(42).setAlpha(0.94);

      const label = this.add.text(zone.center.x, zone.center.y + 56, zone.suit.toUpperCase(), {
        color: "#ffffff",
        fontFamily: "Trebuchet MS, sans-serif",
        fontSize: "28px",
        fontStyle: "bold"
      }).setOrigin(0.5).setDepth(42);

      const suit = this.add.text(zone.center.x, zone.center.y - 1, "", {
        color: "#ffffff",
        fontFamily: "Trebuchet MS, sans-serif",
        fontSize: "1px",
        fontStyle: "bold"
      }).setOrigin(0.5).setDepth(42).setAlpha(0);

      this.zoneVisuals.set(zone.id, { zone, glow, body, halo, label, suit });
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
    this.beltFx.fillCircle(snapshot.beltEnd.x - 12, snapshot.beltEnd.y + 8, 32);
  }

  private syncZones(snapshot: GameSnapshot): void {
    for (const zone of snapshot.zones) {
      const visual = this.zoneVisuals.get(zone.id);
      if (!visual) {
        continue;
      }
      const isTarget = snapshot.activeDragSuit === zone.suit;
      visual.glow.setAlpha(isTarget ? 0.2 : 0.06);
      visual.halo.setAlpha(isTarget ? 1 : 0.94);
      visual.body.setScale(isTarget ? 1.03 : 1);
      visual.body.setFillStyle(isTarget ? 0x15592f : 0x0e3d23, isTarget ? 0.84 : 0.72);
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
      this.input.setDraggable(view);
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
          targets: [zone.glow, zone.halo, zone.label],
          alpha: 0.44,
          duration: 110,
          yoyo: true,
          onComplete: () => {
            zone.glow.setFillStyle(0xffffff, 0.06);
            zone.body.setStrokeStyle(3, 0xe9f4ea, 0.5);
          }
        });
      }
    }

    if (view) {
      const destination = event.worldPoint;
      const scale = event.type === "sorted" ? 0.72 : 0.9;
      const angle = event.type === "mistake" ? 18 : 0;
      const offsetY = event.type === "miss" ? 54 : 0;

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
}
