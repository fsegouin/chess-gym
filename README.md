# Chess Gym

Chess Gym is a minimalist 3D chess trainer for desktop and mobile browsers, with an adjustable engine opponent and a training coach.

- **3D board** rendered with three.js `WebGPURenderer`. It uses WebGPU where the browser supports it and falls back to WebGL 2 automatically. Pieces are generated procedurally, so there are no model files to download.
- **Opponent** is Stockfish 19 (lite, single-threaded WASM) running in a Web Worker. Its strength is set by Elo from 400 to 3000.
- **Training mode** runs a second, full-strength engine as a coach. It reviews each of your moves and pauses the game when you slip.
- **Settings and the current game** are saved in `localStorage`, so a reload picks up where you left off. Board themes are Auto (follows the system light or dark mode), Porcelain, Midnight, Graphite, Walnut and Sage.

## Getting started

```fish
pnpm install
pnpm dev
```

Open http://localhost:3000. `pnpm dev` and `pnpm build` first copy the Stockfish build from `node_modules/stockfish` into `public/engine/` (git-ignored).

Other scripts: `pnpm build`, `pnpm start`, `pnpm lint`, `pnpm typecheck`.

## How training works

After each of your moves the coach analyses the position before and after it, then grades the move by how much of your winning chances it gave away:

| Grade | Winning chances lost | Move list mark |
| --- | --- | --- |
| Best | played the engine's move | `!` |
| Good | under 10% | none |
| Inaccuracy | 10% or more | `?!` |
| Mistake | 20% or more | `?` |
| Blunder | 30% or more, or a forced mate thrown away | `??` |

Using winning chances rather than raw centipawns means a slip in a position that is already decided weighs less than the same slip in a balanced one.

When a move reaches the threshold you pick in settings (inaccuracies, mistakes or blunders), the game pauses on a coach card:

- **Try again** takes the move back so you can look for a better one.
- **Threat** draws the opponent's best reply to your move (red arrow).
- **Best move** reveals the move the coach preferred (green arrow).
- **Keep my move** carries on and lets the opponent reply.

Moves below the threshold get a short verdict chip instead. **Hint** draws the coach's best move for the current position (blue arrow). The evaluation bar shows the coach's latest assessment.

## Opponent strength

From 1320 Elo up, the engine uses Stockfish's own calibrated `UCI_LimitStrength` / `UCI_Elo`. Below that range Stockfish has no calibration, so lower ratings combine a low `Skill Level`, a shallow search depth and an occasional random move. Treat those ratings as approximate. At 3000 ("Max") the engine plays without limits.

## Project layout

```
app/                    Next.js App Router shell and global styles
components/ChessApp.tsx Main client component: wires the game, the scene and the UI
components/*            Coach card, move list, eval bar, settings sheet, dialogs
lib/game.ts             GameController: rules (chess.js), engines, training flow, persistence
lib/engine.ts           UCI client for Stockfish in a Web Worker; Elo to engine settings
lib/coach.ts            Move grading and score formatting
lib/scene/BoardScene.ts three.js scene: board, animations, picking, highlights, arrows, camera
lib/scene/pieces.ts     Procedural piece geometry
lib/settings.ts         Settings store backed by localStorage
lib/themes.ts           Board and UI palettes; Auto follows the system light or dark mode
scripts/copy-engine.mjs Copies the Stockfish build into public/engine
```

## Controls

- Tap or click a piece, then a highlighted square, to move.
- Drag to orbit the board; pinch or scroll to zoom. **View** resets the camera.
- **New** opens the new game dialog.
- **Undo** takes back your last move and the reply to it.
- **Hint** (training mode only) draws the coach's best move.
- Escape clears the selection or closes a dialog.

## Deployment

The app is fully static (`○ /` in the build output). Deploy it to any static host or to Vercel; the engine needs no special headers because it is the single-threaded build.

## License note

Stockfish is GPL-3.0. It is loaded as a separate worker script from `public/engine/`. If you distribute this app, make the Stockfish source available as the GPL requires (the `stockfish` npm package points to it).
