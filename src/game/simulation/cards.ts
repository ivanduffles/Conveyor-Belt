export type Suit = "hearts" | "diamonds" | "clubs" | "spades";

export interface DeckCard {
  rank: string;
  suit: Suit;
}

export const SUITS: Suit[] = ["hearts", "diamonds", "clubs", "spades"];

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export function createShuffledDeck(): DeckCard[] {
  const deck = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));

  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const temp = deck[index];
    deck[index] = deck[swapIndex];
    deck[swapIndex] = temp;
  }

  return deck;
}
