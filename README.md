# Chess Gym

Chess Gym is a minimalist 3D chess trainer for desktop and mobile browsers, with an adjustable engine opponent and a training coach.

- **3D board** rendered with three.js `WebGPURenderer`. It uses WebGPU where the browser supports it and falls back to WebGL 2 automatically. Pieces and their surfaces (wood, stone, brushed metal, ceramic, clay) are generated procedurally, so there are no model or texture files to download. High quality adds ambient occlusion and soft shadows.
- **Opponent** is Stockfish 19 (lite, single-threaded WASM) running in a Web Worker. Its strength is set by Elo from 400 to 3000.
- **Training mode** runs a second, full-strength engine as a coach. It reviews each of your moves and pauses the game when you slip.
- **Clocks** for both players, with time controls from bullet (1 + 0) to classical (30 + 20), or no limit with clocks that count up. In "5 + 3", each player has 5 minutes in total and gains 3 seconds after every move (an increment, not a per-move limit); you lose when your total runs out. The engine budgets its thinking time to its own clock.
- **Your rating** is tracked locally with the Elo formula. Games in Play mode count against the engine strength you picked, unless you undo, ask for a hint, try a move again, or change the strength or mode mid-game. Resigning, running out of time and starting a new game after your first move in a rated game count as losses.
- **Replay**: select any move in the list to replay it on the board. Coach grades and the better move are shown as you step through.
- **Keyboard and screen readers**: every action has a shortcut, pieces can be moved with the arrow keys or by typing a move, and moves, coach verdicts and game status are announced.
- **Settings, your rating and the current game** are saved in `localStorage`, so a reload picks up where you left off. Board themes are Auto (follows the system light or dark mode), Porcelain, Midnight, Graphite, Walnut and Sage.

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

Moves below the threshold get a short verdict chip instead. **Hint** draws the coach's best move for the current position (blue arrow).

The evaluation bar shows the coach's latest assessment, measured in pawns: "White +1.5" means White is ahead by about a pawn and a half, and "M3" means a forced mate in 3. The more of the bar is white, the better White stands. Clocks pause while the coach reviews a move, so training never costs time.

## Opponent strength

From 1320 Elo up, the engine uses Stockfish's own calibrated `UCI_LimitStrength` / `UCI_Elo`. Below that range Stockfish has no calibration, so lower ratings combine a low `Skill Level`, a shallow search depth and an occasional random move. Treat those ratings as approximate. At 3000 ("Max") the engine plays without limits.

## Project layout

```
app/                    Next.js App Router shell and global styles
components/ChessApp.tsx Main client component: game, scene, keyboard shortcuts, replay, announcements
components/*            Coach card, clocks, move list, move input, replay banner, eval bar, time control select, dialogs, cheatsheet
lib/game.ts             GameController: rules (chess.js), engines, training flow, clocks, rating, persistence
lib/engine.ts           UCI client for Stockfish in a Web Worker; Elo to engine settings
lib/coach.ts            Move grading and evaluation wording
lib/clock.ts            Time controls and clock formatting
lib/rating.ts           Local Elo rating store
lib/speech.ts           Moves and squares in words for screen readers
lib/sound.ts            Move, capture, check and end-of-game sound effects
lib/scene/BoardScene.ts three.js scene: board, animations, picking, highlights, arrows, camera, post-processing
lib/scene/pieces.ts     Procedural piece geometry
lib/scene/textures.ts   Procedural wood, stone, metal, ceramic and clay surfaces
lib/settings.ts         Settings store backed by localStorage
lib/themes.ts           Board and UI palettes; Auto follows the system light or dark mode
scripts/copy-engine.mjs Copies the Stockfish build into public/engine
```

## Controls

- Tap or click a piece, then a highlighted square, to move.
- Drag to orbit the board; pinch or scroll to zoom. **Reset camera** appears once you move the view.
- **New** opens the new game dialog, **Undo** takes back your last move and the reply to it, **Hint** (training mode) draws the coach's best move and **Resign** ends the game.

Keyboard shortcuts (press Esc or ? in the app for the full list):

| Keys | Action |
| --- | --- |
| Arrow keys, Enter or Space | Move the board cursor, pick up and drop a piece |
| / | Type a move: `e4`, `Nf3`, `O-O` or `e2e4` |
| Q, R, B, N | Choose a promotion piece |
| Esc | Leave a replay, cancel the selection, or show the shortcut list |
| N, U (or Ctrl/Cmd + Z), H, M, S | New game, undo, hint, switch mode, settings |
| R, T, B, K | Coach review: try again, threat, best move, keep my move |
| [ and ], Home, End | Replay: previous and next move, start, back to the game |
| V, F, Shift + arrows, + and - | Camera: reset, other side, orbit and tilt, zoom |

## Deployment

The app is fully static (`○ /` in the build output). Deploy it to Vercel or anywhere that runs `next start`; the engine needs no cross-origin isolation because it is the single-threaded build.

`next.config.ts` sends a Content Security Policy and related security headers. The policy allows `'wasm-unsafe-eval'` for the engine's WebAssembly and `'unsafe-inline'` scripts, because a static page cannot carry per-request nonces. A plain static host does not apply these headers, so configure equivalent ones there.

## License note

Stockfish is GPL-3.0. It is loaded as a separate worker script from `public/engine/`. If you distribute this app, make the Stockfish source available as the GPL requires (the `stockfish` npm package points to it).
