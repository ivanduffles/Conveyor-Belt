import { SUITS, createShuffledDeck, type DeckCard, type Suit } from "./cards";

export interface Point {
  x: number;
  y: number;
}

export type ZoneId = "west" | "east";
export type GestureIntent = "west" | "east" | "trash" | "none";
export type BannerTone = "good" | "warn" | "bad" | "neutral";

export interface ZoneLayout {
  id: ZoneId;
  direction: string;
  suit: Suit;
  center: Point;
  width: number;
  height: number;
  accent: number;
}

export interface CardRenderState extends DeckCard {
  id: number;
  x: number;
  y: number;
  rotation: number;
  progress: number;
  dragging: boolean;
}

export interface GameSnapshot {
  score: number;
  streak: number;
  sorted: number;
  missed: number;
  mistakes: number;
  elapsedSeconds: number;
  beltPixelsPerSecond: number;
  spawnInterval: number;
  difficulty: number;
  activeDragSuit: Suit | null;
  bannerText: string | null;
  bannerTone: BannerTone;
  zones: ZoneLayout[];
  cards: CardRenderState[];
  beltStart: Point;
  beltEnd: Point;
  beltWidth: number;
}

export interface GameEvent {
  type: "sorted" | "mistake" | "miss" | "trash";
  cardId: number;
  zoneId: ZoneId | null;
  scoreDelta: number;
  worldPoint: Point;
}

interface ActiveCard extends DeckCard {
  id: number;
  progress: number;
  laneOffset: number;
  wobblePhase: number;
  dragging: boolean;
  dragPosition: Point | null;
  dragOrigin: Point | null;
  dragStartPointer: Point | null;
}

const CARD_LIMIT = 8;
const BASE_BELT_SPEED = 100;
const MAX_BELT_SPEED = 500;
const SPEED_STEP_INTERVAL_SECONDS = 10;
const SPEED_STEP_MULTIPLIER = 0.1;
const MISS_PENALTY = -25;
const MISTAKE_PENALTY = -65;
const SORT_POINTS = 10;
const INTRA_BATCH_SPACING_PIXELS = 175;
const INTER_BATCH_MIN_FRACTION = 0.06;
const INTER_BATCH_MAX_FRACTION = 0.16;
const BATCH_LENGTH_DELAY_RATIO = 0.25;
const BATCH_MEAN = 4;
const BATCH_STD_DEV = 1.45;
const BATCH_SIZES = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const FEEDER_CLEAR_HEAD_START_PROGRESS = -0.02;
const FEEDER_OCCUPIED_HEAD_START_PROGRESS = -0.06;
const FEEDER_CLEAR_THRESHOLD_PROGRESS = 0.12;
const CARD_BELT_FOOTPRINT_PIXELS = 210;
const MAX_CARD_OVERLAP_RATIO = 0.7;
const MIN_RENDER_PROGRESS = -1.2;
const MAX_RENDER_PROGRESS = 1.08;

const ZONE_ACCENTS: Record<Suit, number> = {
  hearts: 0xff6b7d,
  diamonds: 0xffb248,
  clubs: 0x53d2b3,
  spades: 0x7aa9ff
};

export class ConveyorSortGame {
  private readonly width: number;
  private readonly height: number;
  private readonly beltStart: Point;
  private readonly beltEnd: Point;
  private readonly beltWidth: number;
  private readonly beltLength: number;
  private readonly beltCenterX: number;
  private readonly beltMidpointY: number;

  private zones: ZoneLayout[] = [];
  private activeCards = new Map<number, ActiveCard>();
  private nextCardId = 1;
  private deck: DeckCard[] = [];
  private enabledSuits: Suit[] = [];
  private batchDistanceRemaining = 0;
  private score = 0;
  private streak = 0;
  private sorted = 0;
  private missed = 0;
  private mistakes = 0;
  private elapsedSeconds = 0;
  private events: GameEvent[] = [];
  private bannerText: string | null = "Sort by suit before the belt outruns you.";
  private bannerTone: BannerTone = "neutral";
  private bannerTimer = 2.4;
  private draggingCardId: number | null = null;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.beltCenterX = width / 2;
    this.beltWidth = Math.min(236, width * 0.264);
    this.beltStart = { x: this.beltCenterX, y: 100 };
    this.beltEnd = { x: this.beltCenterX, y: 1530 };
    this.beltMidpointY = (this.beltStart.y + this.beltEnd.y) / 2;
    this.beltLength = Math.hypot(this.beltEnd.x - this.beltStart.x, this.beltEnd.y - this.beltStart.y);
    this.reset();
  }

  reset(): void {
    const [westSuit, eastSuit] = this.pickZoneSuits();

    this.activeCards.clear();
    this.nextCardId = 1;
    this.enabledSuits = [westSuit, eastSuit];
    this.deck = createShuffledDeck();
    this.zones = [
      this.createZone("west", "WEST", 172, this.beltMidpointY, westSuit),
      this.createZone("east", "EAST", this.width - 172, this.beltMidpointY, eastSuit)
    ];
    this.batchDistanceRemaining = 0;
    this.score = 0;
    this.streak = 0;
    this.sorted = 0;
    this.missed = 0;
    this.mistakes = 0;
    this.elapsedSeconds = 0;
    this.events = [];
    this.bannerText = `Sort ${this.formatSuitName(westSuit)} west and ${this.formatSuitName(eastSuit)} east. Ignore the other suits.`;
    this.bannerTone = "neutral";
    this.bannerTimer = 2.8;
    this.draggingCardId = null;
  }

  update(deltaSeconds: number): void {
    this.elapsedSeconds += deltaSeconds;

    if (this.bannerTimer > 0) {
      this.bannerTimer = Math.max(0, this.bannerTimer - deltaSeconds);
      if (this.bannerTimer === 0) {
        this.bannerText = null;
      }
    }

    const cardsToMiss: ActiveCard[] = [];
    const traveledDistance = this.getBeltPixelsPerSecond() * deltaSeconds;
    const progressStep = traveledDistance / this.beltLength;

    for (const card of this.activeCards.values()) {
      card.progress += progressStep;
      if (card.progress >= 1.04) {
        cardsToMiss.push(card);
      }
    }

    this.batchDistanceRemaining -= traveledDistance;
    while (this.batchDistanceRemaining <= 0 && this.activeCards.size < CARD_LIMIT) {
      const spawnedCount = this.spawnBatch();
      if (spawnedCount === 0) {
        break;
      }
      this.batchDistanceRemaining +=
        this.getInterBatchDistance() +
        (spawnedCount - 1) * this.getIntraBatchSpacingPixels() * BATCH_LENGTH_DELAY_RATIO;
    }

    for (const card of cardsToMiss) {
      this.activeCards.delete(card.id);
      if (this.draggingCardId === card.id) {
        this.draggingCardId = null;
      }
      if (!this.enabledSuits.includes(card.suit)) {
        continue;
      }
      this.streak = 0;
      this.missed += 1;
      this.score += MISS_PENALTY;
      this.events.push({
        type: "miss",
        cardId: card.id,
        zoneId: null,
        scoreDelta: MISS_PENALTY,
        worldPoint: { ...this.beltEnd }
      });
      this.setBanner("Missed a card.", "warn", 1.2);
    }
  }

  startFrontCardGesture(pointer: Point): number | null {
    const card = this.getFrontCard();
    if (!card) {
      return null;
    }

    const currentPosition = this.getRenderedCardPosition(card);
    card.dragging = true;
    card.dragOrigin = currentPosition;
    card.dragStartPointer = { ...pointer };
    card.dragPosition = currentPosition;
    this.draggingCardId = card.id;
    return card.id;
  }

  moveActiveGesture(pointer: Point): void {
    const card = this.getDraggingCard();
    if (!card || !card.dragOrigin || !card.dragStartPointer) {
      return;
    }

    const dx = pointer.x - card.dragStartPointer.x;
    const dy = pointer.y - card.dragStartPointer.y;
    card.dragPosition = {
      x: card.dragOrigin.x + dx,
      y: card.dragOrigin.y + dy
    };
  }

  cancelActiveGesture(): void {
    const card = this.getDraggingCard();
    if (!card) {
      return;
    }

    this.clearDraggingState(card);
  }

  resolveActiveGesture(intent: GestureIntent): void {
    const card = this.getDraggingCard();
    if (intent === "none") {
      this.cancelActiveGesture();
      return;
    }

    if (intent === "trash") {
      this.trashActiveCard();
      return;
    }

    const dropZone = this.getZoneById(intent);
    if (!card || !dropZone) {
      return;
    }

    this.clearDraggingState(card);
    this.activeCards.delete(card.id);
    const dropPoint = { ...dropZone.center };

    if (dropZone.suit === card.suit) {
      this.sorted += 1;
      this.streak += 1;
      const comboBonus = Math.min(this.streak - 1, 10) * 10;
      const scoreDelta = SORT_POINTS + comboBonus;
      this.score += scoreDelta;
      this.events.push({
        type: "sorted",
        cardId: card.id,
        zoneId: dropZone.id,
        scoreDelta,
        worldPoint: dropPoint
      });
      this.setBanner(this.streak >= 4 ? "Hot streak." : "Clean sort.", "good", 0.95);
      return;
    }

    this.streak = 0;
    this.mistakes += 1;
    this.score += MISTAKE_PENALTY;
    this.events.push({
      type: "mistake",
      cardId: card.id,
      zoneId: dropZone.id,
      scoreDelta: MISTAKE_PENALTY,
      worldPoint: dropPoint
    });
    this.setBanner("Wrong chute.", "bad", 1.15);
  }

  trashActiveCard(): void {
    const card = this.getDraggingCard();
    if (!card) {
      return;
    }

    this.clearDraggingState(card);
    this.activeCards.delete(card.id);

    if (this.enabledSuits.includes(card.suit)) {
      this.streak = 0;
      this.missed += 1;
      this.score += MISS_PENALTY;
      this.events.push({
        type: "miss",
        cardId: card.id,
        zoneId: null,
        scoreDelta: MISS_PENALTY,
        worldPoint: { ...this.beltEnd }
      });
      this.setBanner("Trashed a target card.", "warn", 1.2);
      return;
    }

    this.events.push({
      type: "trash",
      cardId: card.id,
      zoneId: null,
      scoreDelta: 0,
      worldPoint: { ...this.beltEnd }
    });
  }

  drainEvents(): GameEvent[] {
    const drained = [...this.events];
    this.events.length = 0;
    return drained;
  }

  getSnapshot(): GameSnapshot {
    return {
      score: this.score,
      streak: this.streak,
      sorted: this.sorted,
      missed: this.missed,
      mistakes: this.mistakes,
      elapsedSeconds: this.elapsedSeconds,
      beltPixelsPerSecond: this.getBeltPixelsPerSecond(),
      spawnInterval: this.getSecondsUntilNextBatch(),
      difficulty: this.getBeltPixelsPerSecond() / BASE_BELT_SPEED,
      activeDragSuit: this.getActiveDragSuit(),
      bannerText: this.bannerText,
      bannerTone: this.bannerTone,
      zones: this.zones,
      cards: [...this.activeCards.values()].map((card) => this.buildRenderCard(card)),
      beltStart: this.beltStart,
      beltEnd: this.beltEnd,
      beltWidth: this.beltWidth
    };
  }

  private createZone(id: ZoneId, direction: string, x: number, y: number, suit: Suit): ZoneLayout {
    return {
      id,
      direction,
      suit,
      center: { x, y },
      width: Math.min(318, this.width * 0.28),
      height: Math.min(404, this.height * 0.25),
      accent: ZONE_ACCENTS[suit]
    };
  }

  private getBeltPixelsPerSecond(): number {
    const speedSteps = Math.floor(this.elapsedSeconds / SPEED_STEP_INTERVAL_SECONDS);
    const multiplier = Math.min(MAX_BELT_SPEED / BASE_BELT_SPEED, (1 + SPEED_STEP_MULTIPLIER) ** speedSteps);
    return Math.min(MAX_BELT_SPEED, BASE_BELT_SPEED * multiplier);
  }

  private getActiveDragSuit(): Suit | null {
    if (this.draggingCardId === null) {
      return null;
    }
    return this.activeCards.get(this.draggingCardId)?.suit ?? null;
  }

  private getSecondsUntilNextBatch(): number {
    return this.batchDistanceRemaining / this.getBeltPixelsPerSecond();
  }

  private spawnBatch(): number {
    const requestedCount = this.sampleBatchSize();
    const availableSlots = CARD_LIMIT - this.activeCards.size;
    const actualCount = Math.max(0, Math.min(requestedCount, availableSlots));

    for (let index = 0; index < actualCount; index += 1) {
      this.spawnCard(index);
    }

    return actualCount;
  }

  private spawnCard(batchIndex: number): void {
    if (this.deck.length === 0) {
      this.deck = createShuffledDeck();
    }

    const next = this.deck.pop();
    if (!next) {
      return;
    }

    const headStartProgress = this.getBatchHeadStartProgress();
    const spacingProgress = this.getMinimumCardSpacingPixels() / this.beltLength;

    this.activeCards.set(this.nextCardId, {
      ...next,
      id: this.nextCardId,
      progress: headStartProgress - batchIndex * spacingProgress,
      laneOffset: -22 + Math.random() * 44,
      wobblePhase: Math.random() * Math.PI * 2,
      dragging: false,
      dragPosition: null,
      dragOrigin: null,
      dragStartPointer: null
    });

    this.nextCardId += 1;
  }

  private getBatchHeadStartProgress(): number {
    const minimumGapProgress = this.getMinimumCardSpacingPixels() / this.beltLength;
    const nearestProgress = [...this.activeCards.values()].reduce<number | null>((nearest, card) => {
      if (nearest === null) {
        return card.progress;
      }
      return Math.min(nearest, card.progress);
    }, null);

    if (nearestProgress === null || nearestProgress > FEEDER_CLEAR_THRESHOLD_PROGRESS) {
      return FEEDER_CLEAR_HEAD_START_PROGRESS;
    }

    return Math.min(FEEDER_OCCUPIED_HEAD_START_PROGRESS, nearestProgress - minimumGapProgress);
  }

  private getIntraBatchSpacingPixels(): number {
    return Math.max(INTRA_BATCH_SPACING_PIXELS, this.getMinimumCardSpacingPixels());
  }

  private getMinimumCardSpacingPixels(): number {
    return CARD_BELT_FOOTPRINT_PIXELS * (1 - MAX_CARD_OVERLAP_RATIO);
  }

  private getInterBatchDistance(): number {
    const gapFraction = INTER_BATCH_MIN_FRACTION + Math.random() * (INTER_BATCH_MAX_FRACTION - INTER_BATCH_MIN_FRACTION);
    return this.beltLength * gapFraction;
  }

  private sampleBatchSize(): number {
    const weights = BATCH_SIZES.map((size) => Math.exp(-((size - BATCH_MEAN) ** 2) / (2 * BATCH_STD_DEV ** 2)));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let roll = Math.random() * totalWeight;

    for (let index = 0; index < BATCH_SIZES.length; index += 1) {
      roll -= weights[index];
      if (roll <= 0) {
        return BATCH_SIZES[index];
      }
    }

    return BATCH_SIZES[BATCH_SIZES.length - 1];
  }

  private buildRenderCard(card: ActiveCard): CardRenderState {
    const renderedPosition = this.getRenderedCardPosition(card);
    const x = card.dragging && card.dragPosition ? card.dragPosition.x : renderedPosition.x;
    const y = card.dragging && card.dragPosition ? card.dragPosition.y : renderedPosition.y;
    const rotation = card.dragging ? 0 : -0.18 + Math.sin(this.elapsedSeconds * 4.5 + card.wobblePhase) * 0.035;

    return {
      id: card.id,
      rank: card.rank,
      suit: card.suit,
      x,
      y,
      rotation,
      progress: card.progress,
      dragging: card.dragging
    };
  }

  private getBeltPoint(progress: number, laneOffset: number): Point {
    const clampedProgress = Math.max(MIN_RENDER_PROGRESS, Math.min(progress, MAX_RENDER_PROGRESS));
    const alongX = this.beltStart.x + (this.beltEnd.x - this.beltStart.x) * clampedProgress;
    const alongY = this.beltStart.y + (this.beltEnd.y - this.beltStart.y) * clampedProgress;
    const normal = this.getBeltNormal();

    return {
      x: alongX + normal.x * laneOffset,
      y: alongY + normal.y * laneOffset
    };
  }

  private getFrontCard(): ActiveCard | null {
    let frontCard: ActiveCard | null = null;

    for (const card of this.activeCards.values()) {
      if (!frontCard || card.progress > frontCard.progress) {
        frontCard = card;
      }
    }

    return frontCard;
  }

  private getDraggingCard(): ActiveCard | null {
    if (this.draggingCardId === null) {
      return null;
    }

    return this.activeCards.get(this.draggingCardId) ?? null;
  }

  private clearDraggingState(card: ActiveCard): void {
    card.dragging = false;
    card.dragPosition = null;
    card.dragOrigin = null;
    card.dragStartPointer = null;

    if (this.draggingCardId === card.id) {
      this.draggingCardId = null;
    }
  }

  private getRenderedCardPosition(card: ActiveCard): Point {
    const beltPoint = this.getBeltPoint(card.progress, card.laneOffset);
    const wobble = Math.sin(this.elapsedSeconds * 3.3 + card.wobblePhase) * 4;
    return {
      x: beltPoint.x,
      y: beltPoint.y + wobble
    };
  }

  private getBeltNormal(): Point {
    const dx = this.beltEnd.x - this.beltStart.x;
    const dy = this.beltEnd.y - this.beltStart.y;
    const length = Math.hypot(dx, dy);
    return {
      x: -dy / length,
      y: dx / length
    };
  }

  private setBanner(text: string, tone: BannerTone, duration: number): void {
    this.bannerText = text;
    this.bannerTone = tone;
    this.bannerTimer = duration;
  }

  private getZoneById(zoneId: ZoneId): ZoneLayout | null {
    return this.zones.find((zone) => zone.id === zoneId) ?? null;
  }

  private pickZoneSuits(): [Suit, Suit] {
    const shuffled = [...SUITS];

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      const temp = shuffled[index];
      shuffled[index] = shuffled[swapIndex];
      shuffled[swapIndex] = temp;
    }

    return [shuffled[0], shuffled[1]];
  }

  private formatSuitName(suit: Suit): string {
    return suit.charAt(0).toUpperCase() + suit.slice(1);
  }
}
