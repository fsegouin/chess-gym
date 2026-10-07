# Chess Gym

Chess Gym is a minimalist 3D chess trainer for desktop and mobile browsers, with an adjustable engine opponent and a training coach.

- **3D board** rendered with three.js `WebGPURenderer`. It uses WebGPU where the browser supports it and falls back to WebGL 2 automatically. Pieces and their surfaces (wood, stone, brushed metal, ceramic, clay) are generated procedurally, so there are no model or texture files to download. High quality adds ambient occlusion and soft shadows.
- **Opponent** is Stockfish 19 (lite, single-threaded WASM) running in a Web Worker. Its strength is set by Elo from 400 to 3000.
- **Training mode** runs a second, full-strength engine as a coach. It reviews each of your moves and pauses the game when you slip. When the game ends, **Review with coach** walks back through it and stops at the moments worth a second look.
- **Clocks** for both players, with time controls from bullet (1 + 0) to classical (30 + 20), or no limit with clocks that count up. In "5 + 3", each player has 5 minutes in total and gains 3 seconds after every move (an increment, not a per-move limit); you lose when your total runs out. The engine budgets its thinking time to its own clock.
- **Start screen** on a fresh visit: nothing runs, not even the clocks, until you press Start game. Mode, colour, opponent and time control are shown there and can be changed first.
- **Your rating** is tracked locally with the Elo formula. Games in Play mode count against the engine strength you picked, unless you undo, ask for a hint, try a move again, or change the strength or mode mid-game. Resigning, running out of time and starting a new game after your first move in a rated game count as losses.
- **Puzzles from your own games**: every slip the coach finds in a finished game (a missed mate, a missed capture, a blunder) becomes a puzzle, and practice brings it back on a spaced-repetition schedule until you have it.
- **Your patterns**: what you miss most, in which phase of the game, how often under time pressure, and how your accuracy is trending.
- **Replay**: select any move in the list to replay it on the board. Coach grades and the better move are shown as you step through.
- **Keyboard and screen readers**: every action has a shortcut, pieces can be moved with the arrow keys or by typing a move, and moves, coach verdicts and game status are announced.
- **Sound** effects are synthesised in the browser (no audio files). Each move sounds different depending on the piece, the square it lands on and the board theme's material, with distinct captures and castling. Turn them off with the Sound toggle in settings.
- **Settings, your rating, your training history and the current game** are saved in `localStorage`, so a reload picks up where you left off. Board themes are Auto (follows the system light or dark mode), Porcelain, Midnight, Graphite, Walnut and Sage.

## Getting started

```fish
pnpm install
pnpm dev
```

Open http://localhost:3000. `pnpm dev` and `pnpm build` first copy the Stockfish build from `node_modules/stockfish` into `public/engine/` (git-ignored).

Other scripts: `pnpm build`, `pnpm start`, `pnpm lint`, `pnpm typecheck`.

## Tests

- `pnpm test` runs the unit tests (Vitest) for the rules around the board: grading, the coach review, clocks, rating, settings, puzzles and their schedule.
- `pnpm test:e2e` runs the browser tests (Playwright) against a dev server it starts, or (outside CI) reuses one already running on port 3211. Set `E2E_PORT` to use another port. They drive the real app in headless Chromium, using a test handle the app exposes in development only. Install the browser once with `pnpm exec playwright install chromium`.

CI runs typecheck, lint, both test suites and the build on every push and pull request. Its runners have no GPU, so there the browser tests use the WebGL 2 fallback.

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

When a game that the coach graded ends (win, loss or draw), **Review with coach** replays it move by move and stops at every moment worth a second look: graded slips, a missed checkmate or forced mate, a strong check or a winning capture you did not play. Each stop shows the position before your move with what you played (orange arrow) and what was better (green arrow), and waits for **Next**. It also stops, in green, on the moves that shaped the game: punishing the opponent's mistake, starting a forced mate, or delivering checkmate. Between stops, **Play** replays the quiet moves, quickly at first and slowing down before the next stop. A summary of how your moves rated closes the review, with **Watch again** to restart it.

Moves below the threshold get a short verdict chip instead. **Hint** draws the coach's best move for the current position (blue arrow).

The evaluation bar shows the coach's latest assessment, measured in pawns: "White +1.5" means White is ahead by about a pawn and a half, and "M3" means a forced mate in 3. The more of the bar is white, the better White stands. Clocks pause while the coach reviews a move, so training never costs time.

## Practice and patterns

When a game ends, every teaching moment of yours becomes a puzzle: the position before your move, with the coach's move as the answer. Open **Your training** (the target button, or P) to practise the ones that are due. A puzzle counts as solved when you find the coach's move, any checkmate, or another move the coach rates just as good. Solve it first time and it comes back in a day, then three, then further apart each time; miss it, use the hint or show the answer, and it comes back in a few minutes. Practice is not available while a timed game is running, since its clock would keep going.

The same dialog shows your patterns across games: which kinds of slip you make most, in which phase of the game, how many came with under 30 seconds on your clock, and the share of your moves the coach rated best or good. All of it stays on your device.

## Opponent strength

From 1320 Elo up, the engine uses Stockfish's own calibrated `UCI_LimitStrength` / `UCI_Elo`. Below that range Stockfish has no calibration, so lower ratings combine a low `Skill Level`, a shallow search depth and an occasional random move. Treat those ratings as approximate. At 3000 ("Max") the engine plays without limits.

## Project layout

```
app/                    Next.js App Router shell and global styles
components/ChessApp.tsx Main client component: game, scene, keyboard shortcuts, replay, announcements
components/*            Start screen, coach card, game-over card, post-game review panel, puzzle panel, training dialog, clocks, move list, move input, replay banner, eval bar, time control select, dialogs, cheatsheet
lib/game.ts             GameController: rules (chess.js), engines, training flow, clocks, rating, persistence
lib/engine.ts           UCI client for Stockfish in a Web Worker; Elo to engine settings
lib/coach.ts            Move grading and evaluation wording
lib/lesson.ts           Post-game coach review: teaching moments and lesson steps
lib/training.ts         Puzzles from your games, their spaced-repetition schedule, game records and patterns
lib/puzzle.ts           Solving a puzzle: legal moves and judging an answer
lib/moves.ts            Legal targets and typed-move parsing shared by games and puzzles
lib/clock.ts            Time controls and clock formatting
lib/rating.ts           Local Elo rating store
lib/speech.ts           Moves and squares in words for screen readers
lib/sound.ts            Synthesised sound effects (no audio files) that vary by piece, square and board material
lib/scene/BoardScene.ts three.js scene: board, animations, picking, highlights, arrows, camera, post-processing
lib/scene/pieces.ts     Procedural piece geometry
lib/scene/textures.ts   Procedural wood, stone, metal, ceramic and clay surfaces
lib/settings.ts         Settings store backed by localStorage
lib/themes.ts           Board and UI palettes; Auto follows the system light or dark mode
lib/test-browser.ts     Browser stand-in (window, localStorage) for unit tests of modules that persist
lib/*.test.ts           Unit tests (Vitest)
e2e/                    Browser tests (Playwright) and shared helpers
vitest.config.mts       Vitest setup: node environment, lib/**/*.test.ts
playwright.config.ts    Playwright setup: dev server on E2E_PORT (default 3211), headless Chromium
.github/workflows/ci.yml  CI: typecheck, lint, tests, build, browser tests
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
| N, U (or Ctrl/Cmd + Z), H, M, P, S | New game, undo, hint, switch mode, your training, settings |
| H, Enter, Esc | Puzzles: hint, next puzzle, leave practice |
| R, T, B, K | Coach review: try again, threat, best move, keep my move |
| [ and ], Home, End | Replay: previous and next move, start, back to the game |
| Right arrow, Enter or Space, Left arrow, P, Home, Esc | Post-game review: next, previous, play or pause, restart, leave |
| V, F, Shift + arrows, + and - | Camera: reset, other side, orbit and tilt, zoom |

## Deployment

The app is fully static (`○ /` in the build output). Deploy it to Vercel or anywhere that runs `next start`; the engine needs no cross-origin isolation because it is the single-threaded build.

`next.config.ts` sends a Content Security Policy and related security headers. The policy allows `'wasm-unsafe-eval'` for the engine's WebAssembly and `'unsafe-inline'` scripts, because a static page cannot carry per-request nonces. A plain static host does not apply these headers, so configure equivalent ones there.

## License note

Stockfish is GPL-3.0. It is loaded as a separate worker script from `public/engine/`. If you distribute this app, make the Stockfish source available as the GPL requires (the `stockfish` npm package points to it).
