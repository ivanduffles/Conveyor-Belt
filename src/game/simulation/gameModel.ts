import { createShuffledDeck, type DeckCard, type Suit } from "./cards";

export interface Point {
  x: number;
  y: number;
}

export type ZoneId = "north" | "east" | "south" | "west";
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
  type: "sorted" | "mistake" | "miss";
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
}

const CARD_LIMIT = 18;
const BASE_BELT_SPEED = 90;
const MAX_BELT_SPEED = BASE_BELT_SPEED * 4;
const SPEED_STEP_INTERVAL_SECONDS = 10;
const SPEED_STEP_MULTIPLIER = 0.07;
const MISS_PENALTY = -25;
const MISTAKE_PENALTY = -65;
const SORT_POINTS = 110;
const SNAP_RADIUS = 220;
const VERTICAL_THROW_RATIO = 0.78;
const INTRA_BATCH_SPACING_PIXELS = 175;
const INTER_BATCH_MIN_FRACTION = 0.16;
const INTER_BATCH_MAX_FRACTION = 0.26;
const BATCH_LENGTH_DELAY_RATIO = 0.35;
const BATCH_MEAN = 5;
const BATCH_STD_DEV = 1.45;
const BATCH_SIZES = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const FEEDER_CLEAR_HEAD_START_PROGRESS = -0.02;
const FEEDER_OCCUPIED_HEAD_START_PROGRESS = -0.06;
const FEEDER_CLEAR_THRESHOLD_PROGRESS = 0.12;
const CARD_BELT_FOOTPRINT_PIXELS = 210;
const MAX_CARD_OVERLAP_PIXELS = 34;
const MIN_RENDER_PROGRESS = -1.2;
const MAX_RENDER_PROGRESS = 1.08;

const SUIT_TO_ZONE: Record<ZoneId, Suit> = {
  north: "hearts",
  east: "diamonds",
  south: "spades",
  west: "clubs"
};

const ZONE_ACCENTS: Record<Suit, number> = {
  hearts: 0xff6b7d,
  diamonds: 0xffb248,
  clubs: 0x53d2b3,
  spades: 0x7aa9ff
};

export class ConveyorSortGame {
  private readonly width: number;
  private readonly height: number;
  private readonly screenCenter: Point;
  private readonly beltStart: Point;
  private readonly beltEnd: Point;
  private readonly beltWidth: number;
  private readonly beltLength: number;
  private readonly zones: ZoneLayout[];

  private activeCards = new Map<number, ActiveCard>();
  private nextCardId = 1;
  private deck: DeckCard[] = [];
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
    this.screenCenter = { x: width / 2, y: height / 2 };
    this.beltWidth = Math.min(190, width * 0.22);
    this.beltStart = { x: width - 110, y: 425 };
    this.beltEnd = { x: 120, y: height - 117 };
    this.beltLength = Math.hypot(this.beltEnd.x - this.beltStart.x, this.beltEnd.y - this.beltStart.y);
    this.zones = [
      this.createZone("north", "NORTH", width / 2, 315),
      this.createZone("east", "EAST", width - 124, height / 2 + 145),
      this.createZone("south", "SOUTH", width / 2, height - 85),
      this.createZone("west", "WEST", 124, height / 2 + 145)
    ];
    this.reset();
  }

  reset(): void {
    this.activeCards.clear();
    this.nextCardId = 1;
    this.deck = createShuffledDeck();
    this.batchDistanceRemaining = 0;
    this.score = 0;
    this.streak = 0;
    this.sorted = 0;
    this.missed = 0;
    this.mistakes = 0;
    this.elapsedSeconds = 0;
    this.events = [];
    this.bannerText = "Sort by suit before the belt outruns you.";
    this.bannerTone = "neutral";
    this.bannerTimer = 2.4;
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

  startDrag(cardId: number, pointer: Point): void {
    const card = this.activeCards.get(cardId);
    if (!card) {
      return;
    }

    card.dragging = true;
    card.dragPosition = { ...pointer };
    this.draggingCardId = card.id;
  }

  moveDrag(cardId: number, pointer: Point): void {
    const card = this.activeCards.get(cardId);
    if (!card || !card.dragging) {
      return;
    }

    card.dragPosition = { ...pointer };
  }

  endDrag(cardId: number, pointer: Point): void {
    const card = this.activeCards.get(cardId);
    if (!card) {
      return;
    }

    card.dragPosition = { ...pointer };
    const dropZone = this.findDropZone(pointer);
    card.dragging = false;
    card.dragPosition = null;
    this.draggingCardId = null;

    if (!dropZone) {
      return;
    }

    this.activeCards.delete(card.id);
    const dropPoint = { ...dropZone.center };

    if (dropZone.suit === card.suit) {
      this.sorted += 1;
      this.streak += 1;
      const comboBonus = Math.min(this.streak - 1, 6) * 10;
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

  private createZone(id: ZoneId, direction: string, x: number, y: number): ZoneLayout {
    const suit = SUIT_TO_ZONE[id];
    const width = id === "east" || id === "west"
      ? Math.min(248, this.width * 0.276)
      : Math.min(248, this.width * 0.27);

    return {
      id,
      direction,
      suit,
      center: { x, y },
      width,
      height: Math.min(196, this.height * 0.12),
      accent: ZONE_ACCENTS[suit]
    };
  }

  private getBeltPixelsPerSecond(): number {
    const speedSteps = Math.floor(this.elapsedSeconds / SPEED_STEP_INTERVAL_SECONDS);
    const multiplier = Math.min(4, (1 + SPEED_STEP_MULTIPLIER) ** speedSteps);
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
    const spacingProgress = this.getIntraBatchSpacingPixels() / this.beltLength;

    this.activeCards.set(this.nextCardId, {
      ...next,
      id: this.nextCardId,
      progress: headStartProgress - batchIndex * spacingProgress,
      laneOffset: -22 + Math.random() * 44,
      wobblePhase: Math.random() * Math.PI * 2,
      dragging: false,
      dragPosition: null
    });

    this.nextCardId += 1;
  }

  private getBatchHeadStartProgress(): number {
    const nearestProgress = [...this.activeCards.values()].reduce<number | null>((nearest, card) => {
      if (nearest === null) {
        return card.progress;
      }
      return Math.min(nearest, card.progress);
    }, null);

    if (nearestProgress === null || nearestProgress > FEEDER_CLEAR_THRESHOLD_PROGRESS) {
      return FEEDER_CLEAR_HEAD_START_PROGRESS;
    }

    return FEEDER_OCCUPIED_HEAD_START_PROGRESS;
  }

  private getIntraBatchSpacingPixels(): number {
    return Math.max(INTRA_BATCH_SPACING_PIXELS, CARD_BELT_FOOTPRINT_PIXELS - MAX_CARD_OVERLAP_PIXELS);
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
    const beltPoint = this.getBeltPoint(card.progress, card.laneOffset);
    const wobble = Math.sin(this.elapsedSeconds * 3.3 + card.wobblePhase) * 4;
    const x = card.dragging && card.dragPosition ? card.dragPosition.x : beltPoint.x;
    const y = card.dragging && card.dragPosition ? card.dragPosition.y : beltPoint.y + wobble;
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

  private getBeltNormal(): Point {
    const dx = this.beltEnd.x - this.beltStart.x;
    const dy = this.beltEnd.y - this.beltStart.y;
    const length = Math.hypot(dx, dy);
    return {
      x: -dy / length,
      y: dx / length
    };
  }

  private findDropZone(point: Point): ZoneLayout | null {
    const horizontalThrowDistance = Math.min(
      ...this.zones
        .filter((zone) => zone.id === "east" || zone.id === "west")
        .map((zone) => Math.abs(zone.center.x - this.screenCenter.x))
    );

    const northZone = this.zones.find((zone) => zone.id === "north") ?? null;
    const southZone = this.zones.find((zone) => zone.id === "south") ?? null;

    const verticalThrowDistance = horizontalThrowDistance * VERTICAL_THROW_RATIO;

    if (
      northZone &&
      point.y <= this.screenCenter.y - verticalThrowDistance &&
      Math.abs(point.x - this.screenCenter.x) <= northZone.width / 2 + 110
    ) {
      return northZone;
    }

    if (
      southZone &&
      point.y >= this.screenCenter.y + verticalThrowDistance &&
      Math.abs(point.x - this.screenCenter.x) <= southZone.width / 2 + 110
    ) {
      return southZone;
    }

    for (const zone of this.zones) {
      const expandedWidth = zone.width / 2 + 72;
      const expandedHeight = zone.height / 2 + 60;
      if (Math.abs(point.x - zone.center.x) <= expandedWidth && Math.abs(point.y - zone.center.y) <= expandedHeight) {
        return zone;
      }
    }

    let bestZone: ZoneLayout | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const zone of this.zones) {
      const distance = Math.hypot(point.x - zone.center.x, point.y - zone.center.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestZone = zone;
      }
    }

    return bestDistance <= SNAP_RADIUS ? bestZone : null;
  }

  private setBanner(text: string, tone: BannerTone, duration: number): void {
    this.bannerText = text;
    this.bannerTone = tone;
    this.bannerTimer = duration;
  }
}
