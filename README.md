# Conveyor Belt

Fast card-sorting minigame prototype built with Phaser, TypeScript, and Vite.

## Loop

Cards spawn from a feeder tunnel onto a diagonal conveyor belt. Drag each card into the matching suit bay:

- `North` for hearts
- `East` for diamonds
- `South` for spades
- `West` for clubs

You gain points for correct sorts, lose points for missed cards, and lose more for dropping a card into the wrong suit bay. The belt and spawn rate both ramp up over time.

## Commands

```bash
npm install
npm run dev
```

Press `R` in-game to restart the shift.
