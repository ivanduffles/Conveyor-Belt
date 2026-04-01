import Phaser from "phaser";
import type { CardRenderState } from "../../game/simulation/gameModel";
import type { Suit } from "../../game/simulation/cards";

const SUIT_SYMBOLS: Record<Suit, string> = {
  hearts: "\u2665",
  diamonds: "\u2666",
  clubs: "\u2663",
  spades: "\u2660"
};

const SUIT_COLORS: Record<Suit, number> = {
  hearts: 0xd44343,
  diamonds: 0xe16a3f,
  clubs: 0x172033,
  spades: 0x172033
};

export class CardView extends Phaser.GameObjects.Container {
  readonly cardId: number;

  private readonly shadow: Phaser.GameObjects.Rectangle;
  private readonly face: Phaser.GameObjects.Rectangle;
  private readonly outline: Phaser.GameObjects.Rectangle;
  private static readonly CARD_WIDTH = 147;
  private static readonly CARD_HEIGHT = 208;
  private static readonly HIT_HALF_WIDTH = 101;
  private static readonly HIT_HALF_HEIGHT = 129;

  constructor(scene: Phaser.Scene, card: CardRenderState) {
    super(scene, card.x, card.y);
    this.cardId = card.id;

    this.shadow = scene.add.rectangle(10, 14, 152, 214, 0x071019, 0.28);
    this.face = scene.add.rectangle(0, 0, CardView.CARD_WIDTH, CardView.CARD_HEIGHT, 0xfdf7ee, 1);
    this.outline = scene.add.rectangle(0, 0, CardView.CARD_WIDTH, CardView.CARD_HEIGHT);
    this.outline.setStrokeStyle(3, 0xe1d6c0, 1);
    const tone = `#${SUIT_COLORS[card.suit].toString(16).padStart(6, "0")}`;

    const topRank = scene.add.text(-52, -74, card.rank, {
      color: tone,
      fontFamily: "Georgia, serif",
      fontSize: "37px",
      fontStyle: "bold"
    }).setOrigin(0.5);

    const topSuit = scene.add.text(-52, -39, SUIT_SYMBOLS[card.suit], {
      color: tone,
      fontFamily: "Georgia, serif",
      fontSize: "32px",
      fontStyle: "bold"
    }).setOrigin(0.5);

    const centerSuit = scene.add.text(0, 4, SUIT_SYMBOLS[card.suit], {
      color: tone,
      fontFamily: "Georgia, serif",
      fontSize: "83px",
      fontStyle: "bold"
    }).setOrigin(0.5);

    const bottomRank = scene.add.text(52, 52, card.rank, {
      color: tone,
      fontFamily: "Georgia, serif",
      fontSize: "37px",
      fontStyle: "bold"
    }).setOrigin(0.5).setAngle(180);

    const bottomSuit = scene.add.text(52, 88, SUIT_SYMBOLS[card.suit], {
      color: tone,
      fontFamily: "Georgia, serif",
      fontSize: "32px",
      fontStyle: "bold"
    }).setOrigin(0.5).setAngle(180);

    this.add([
      this.shadow,
      this.face,
      this.outline,
      topRank,
      topSuit,
      centerSuit,
      bottomRank,
      bottomSuit
    ]);

    this.setSize(CardView.HIT_HALF_WIDTH * 2, CardView.HIT_HALF_HEIGHT * 2);
    this.setInteractive(
      new Phaser.Geom.Rectangle(
        -CardView.HIT_HALF_WIDTH,
        -CardView.HIT_HALF_HEIGHT,
        CardView.HIT_HALF_WIDTH * 2,
        CardView.HIT_HALF_HEIGHT * 2
      ),
      (_area, x, y) => {
        const centered =
          x >= -CardView.HIT_HALF_WIDTH &&
          x <= CardView.HIT_HALF_WIDTH &&
          y >= -CardView.HIT_HALF_HEIGHT &&
          y <= CardView.HIT_HALF_HEIGHT;

        const topLeft =
          x >= 0 &&
          x <= CardView.HIT_HALF_WIDTH * 2 &&
          y >= 0 &&
          y <= CardView.HIT_HALF_HEIGHT * 2;

        return centered || topLeft;
      }
    );
    this.input!.cursor = "grab";
    scene.add.existing(this);
    this.refresh(card, true);
  }

  refresh(card: CardRenderState, immediate = false): void {
    const blend = immediate || card.dragging ? 1 : 0.38;
    this.x = Phaser.Math.Linear(this.x, card.x, blend);
    this.y = Phaser.Math.Linear(this.y, card.y, blend);
    this.rotation = Phaser.Math.Linear(this.rotation, card.rotation, immediate || card.dragging ? 1 : 0.28);

    const targetScale = card.dragging ? 1.06 : 1;
    const nextScale = immediate || card.dragging ? targetScale : Phaser.Math.Linear(this.scaleX, targetScale, 0.24);
    this.setScale(nextScale);

    this.shadow.setAlpha(card.dragging ? 0.38 : 0.28);
    this.face.setFillStyle(card.dragging ? 0xfffaee : 0xfdf7ee, 1);
    this.setDepth(card.dragging ? 3000 : 1000 + card.progress * 1000);
  }
}
