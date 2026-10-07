"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
} from "react";
import type { PieceSymbol, Square } from "chess.js";
import { CLASS_LABEL, formatScore } from "@/lib/coach";
import { GameController, type GameSnapshot } from "@/lib/game";
import { PROVISIONAL_GAMES, useRating } from "@/lib/rating";
import { BoardScene } from "@/lib/scene/BoardScene";
import { ELO_MAX, getSettings, MODE_OPTIONS, updateSettings, useSettings, type PlayerColorChoice } from "@/lib/settings";
import { unlockAudio } from "@/lib/sound";
import { pieceName, sanToSpeech, squareSpeech } from "@/lib/speech";
import { prefersDark, resolveTheme, THEMES, usePrefersDark } from "@/lib/themes";
import { Clocks } from "./Clocks";
import { CoachCard } from "./CoachCard";
import { EvalBar } from "./EvalBar";
import { FeedbackChip } from "./FeedbackChip";
import { IconFlag, IconGear, IconHint, IconKeyboard, IconPlus, IconResetView, IconUndo } from "./icons";
import { MoveInput } from "./MoveInput";
import { MoveList } from "./MoveList";
import { NewGameDialog } from "./NewGameDialog";
import { PromotionPicker } from "./PromotionPicker";
import { ReplayBanner } from "./ReplayBanner";
import { SettingsSheet } from "./SettingsSheet";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Segmented } from "./ui";

type SceneState = { status: "loading" } | { status: "ready"; backend: string } | { status: "error"; message: string };

/** A ply being replayed from the move list; `seq` re-triggers the animation on a repeat click. */
type ReplayView = { ply: number; seq: number; animate: boolean };

const FILES = "abcdefgh";
const ORBIT_STEP = 0.2;
const TILT_STEP = 0.08;

function statusText(game: GameSnapshot): string {
  if (game.engineError) return "Engine unavailable";
  const s = game.status;
  const you = (winner: string) => winner === game.playerColor;
  if (s.kind === "checkmate") return you(s.winner) ? "Checkmate. You win" : "Checkmate. You lose";
  if (s.kind === "timeout") return you(s.winner) ? "Opponent ran out of time. You win" : "Out of time. You lose";
  if (s.kind === "resigned") return you(s.winner) ? "Opponent resigned. You win" : "You resigned";
  if (s.kind === "draw") {
    if (s.reason === "stalemate") return "Stalemate. Draw";
    if (s.reason === "timeout vs insufficient material") return "Out of time, but no mate was possible. Draw";
    return `Draw by ${s.reason}`;
  }
  if (game.review) return "Review your move";
  if (game.reviewing) return "Coach is reviewing";
  if (game.thinking) return "Opponent is thinking";
  if (game.hintPending) return "Looking for a hint";
  if (game.turn !== game.playerColor) return "Opponent to move";
  return game.checkSquare ? "Check. Your move" : "Your move";
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

export default function ChessApp() {
  const settings = useSettings();
  const rating = useRating();
  const theme = THEMES[resolveTheme(settings.theme, usePrefersDark())];
  const [controller] = useState(() => new GameController());
  const game = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  const boardRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<BoardScene | null>(null);
  const [sceneState, setSceneState] = useState<SceneState>({ status: "loading" });
  const sceneReady = sceneState.status === "ready";

  // A selection only lives as long as the position it was made in.
  const [selection, setSelection] = useState<{ square: Square; positionId: number } | null>(null);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [moveInputOpen, setMoveInputOpen] = useState(false);
  const [cursor, setCursor] = useState<Square | null>(null);
  const [cursorSpeech, setCursorSpeech] = useState("");
  const [view, setView] = useState<ReplayView | null>(null);
  const [viewAdjusted, setViewAdjusted] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);

  // Undo can shorten the history under a replay; fall back to the live game then.
  const replay = view && view.ply < game.history.length ? view : null;
  const replayEntry = replay ? game.history[replay.ply] : null;

  const canMove = controller.canMove() && !replay;
  const selected = selection && selection.positionId === game.positionId && canMove ? selection.square : null;
  const targets = useMemo(
    () => (selected ? controller.legalTargets(selected) : []),
    // positionId changes whenever the legal moves can change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, selected, game.positionId],
  );

  useEffect(() => {
    controller.start();
    return () => controller.dispose();
  }, [controller]);

  useEffect(() => {
    let cancelled = false;
    let scene: BoardScene | null = null;
    const host = boardRef.current!;
    // Strict mode mounts, unmounts and remounts synchronously in development. Starting on the
    // next frame means only the surviving mount creates a GPU device.
    const frame = requestAnimationFrame(() => {
      const initial = getSettings();
      BoardScene.create(host, THEMES[resolveTheme(initial.theme, prefersDark())], initial.quality)
        .then((s) => {
          if (cancelled) {
            s.dispose();
            return;
          }
          scene = s;
          sceneRef.current = s;
          s.onViewChange = setViewAdjusted;
          s.setOrientation(controller.getSnapshot().playerColor, false);
          setSceneState({ status: "ready", backend: s.backend });
          if (process.env.NODE_ENV === "development") {
            // Handle for automated browser tests.
            (window as unknown as { __chess?: unknown }).__chess = { controller, scene: s };
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setSceneState({ status: "error", message: err instanceof Error ? err.message : String(err) });
          }
        });
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelled = true;
      scene?.dispose();
      if (process.env.NODE_ENV === "development") {
        const hook = window as unknown as { __chess?: { scene?: unknown } };
        if (scene && hook.__chess?.scene === scene) delete hook.__chess;
      }
      sceneRef.current = null;
    };
  }, [controller]);

  const replayBefore = replayEntry?.before;
  const replayAfter = replayEntry?.after;
  const replayFrom = replayEntry?.from;
  const replayTo = replayEntry?.to;
  const replaySeq = replay?.seq;
  const replayAnimate = replay?.animate;

  useEffect(() => {
    const scene = sceneRef.current;
    if (!sceneReady || !scene) return;
    if (replayAfter && replayBefore && replayFrom && replayTo) {
      // Replaying a move: show the position before it, then play it.
      if (replayAnimate) scene.setPosition(replayBefore);
      scene.setPosition(replayAfter, replayAnimate ? { from: replayFrom, to: replayTo } : null);
      return;
    }
    scene.setPosition(game.fen, game.animate);
  }, [
    sceneReady,
    game.positionId,
    game.fen,
    game.animate,
    replayBefore,
    replayAfter,
    replayFrom,
    replayTo,
    replaySeq,
    replayAnimate,
  ]);

  const replayBest = replayEntry?.annotation;
  const replayArrows = useMemo(() => {
    if (!replayBest?.bestUci || replayBest.cls === "best" || replayBest.cls === "good") return [];
    const uci = replayBest.bestUci;
    return [{ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, kind: "best" as const }];
  }, [replayBest]);

  useEffect(() => {
    sceneRef.current?.setHighlights(
      replayFrom && replayTo
        ? {
            selected: null,
            targets: [],
            lastMove: { from: replayFrom, to: replayTo },
            check: null,
            arrows: replayArrows,
            cursor: null,
          }
        : {
            selected,
            targets: settings.showLegalMoves ? targets : [],
            lastMove: settings.showLastMove ? game.lastMove : null,
            check: game.checkSquare,
            arrows: game.arrows,
            cursor,
          },
    );
  }, [
    sceneReady,
    selected,
    targets,
    settings.showLegalMoves,
    settings.showLastMove,
    game.lastMove,
    game.checkSquare,
    game.arrows,
    cursor,
    replayFrom,
    replayTo,
    replayArrows,
  ]);

  useEffect(() => {
    if (sceneReady) sceneRef.current?.setOrientation(game.playerColor);
  }, [sceneReady, game.playerColor]);

  useEffect(() => {
    if (sceneReady) sceneRef.current?.setTheme(theme);
  }, [sceneReady, theme]);

  useEffect(() => {
    if (sceneReady) sceneRef.current?.setQuality(settings.quality);
  }, [sceneReady, settings.quality]);

  useEffect(() => {
    controller.refresh();
  }, [controller, settings.mode, settings.pauseOn, settings.elo]);

  // The page background and browser chrome follow the board theme.
  useEffect(() => {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(theme.ui)) root.style.setProperty(`--${key}`, value);
    root.dataset.scheme = theme.scheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.ui.bg);
  }, [theme]);

  const goLive = useCallback(() => setView(null), []);

  const selectPly = useCallback((ply: number) => {
    setView((v) => ({ ply, seq: (v?.seq ?? 0) + 1, animate: true }));
  }, []);

  const stepReplay = (delta: number) => {
    const total = game.history.length;
    if (total === 0) return;
    const current = replay ? replay.ply : total;
    const next = current + delta;
    if (next >= total) goLive();
    else if (next >= 0) setView((v) => ({ ply: next, seq: (v?.seq ?? 0) + 1, animate: delta > 0 }));
  };

  const handleTap = useCallback(
    (square: Square | null) => {
      unlockAudio();
      if (promotion) return;
      if (replay) {
        goLive();
        return;
      }
      if (!square) {
        setSelection(null);
        controller.clearArrows();
        return;
      }
      if (!controller.canMove()) return;
      const snap = controller.getSnapshot();
      if (selected) {
        const target = controller.legalTargets(selected).find((t) => t.to === square);
        if (target) {
          if (target.promotion) {
            setPromotion({ from: selected, to: square });
          } else {
            void controller.playerMove(selected, square);
            setSelection(null);
          }
          return;
        }
      }
      const piece = controller.pieceAt(square);
      if (piece && piece.color === snap.playerColor && square !== selected) {
        setSelection({ square, positionId: snap.positionId });
      } else {
        setSelection(null);
      }
    },
    [controller, promotion, selected, replay, goLive],
  );

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.onTap = handleTap;
    scene.isInteractive = (square) => {
      if (!controller.canMove()) return false;
      const piece = controller.pieceAt(square);
      if (piece && piece.color === controller.getSnapshot().playerColor) return true;
      return targets.some((t) => t.to === square);
    };
  }, [sceneReady, handleTap, controller, targets]);

  const choosePromotion = (piece: PieceSymbol) => {
    if (!promotion) return;
    void controller.playerMove(promotion.from, promotion.to, piece);
    setPromotion(null);
    setSelection(null);
  };

  const undo = () => {
    controller.undo();
    setView(null);
    setSelection(null);
  };

  // Retry shortens the history like undo, so a replay of the last move must not linger.
  const retry = () => {
    controller.retry();
    setView(null);
  };

  const resign = () => {
    if (!confirmResign) {
      setConfirmResign(true);
      return;
    }
    setConfirmResign(false);
    controller.resign();
  };

  const startGame = (color: PlayerColorChoice, timeControl: string) => {
    updateSettings({ playerColor: color, timeControl });
    controller.newGame(color, timeControl);
    setSelection(null);
    setView(null);
    setNewGameOpen(false);
  };

  const describeCursor = (square: Square): string => {
    const base = squareSpeech(square, controller.pieceAt(square));
    if (square === selected) return `${base}, selected`;
    const target = targets.find((t) => t.to === square);
    if (target) return `${base}, ${target.capture ? "capture" : "legal move"}`;
    return base;
  };

  const moveCursor = (key: string) => {
    if (replay) {
      setCursorSpeech("Replaying an earlier move. Press End to return to the game.");
      return;
    }
    const start = cursor ?? selected ?? game.lastMove?.to ?? (game.playerColor === "w" ? "e2" : "e7");
    let file = FILES.indexOf(start[0]);
    let rank = Number(start[1]) - 1;
    if (cursor) {
      // Arrows follow the player's view: up is always towards the opponent.
      const dir = game.playerColor === "w" ? 1 : -1;
      if (key === "ArrowUp") rank += dir;
      if (key === "ArrowDown") rank -= dir;
      if (key === "ArrowRight") file += dir;
      if (key === "ArrowLeft") file -= dir;
    }
    file = Math.min(7, Math.max(0, file));
    rank = Math.min(7, Math.max(0, rank));
    const square = `${FILES[file]}${rank + 1}` as Square;
    setCursor(square);
    setCursorSpeech(describeCursor(square));
  };

  const activateCursor = () => {
    if (!cursor) {
      moveCursor("");
      return;
    }
    if (replay) {
      setCursorSpeech("Replaying an earlier move. Press End to return to the game.");
      return;
    }
    if (!controller.canMove()) {
      setCursorSpeech(game.status.kind === "playing" ? "Wait for your turn." : "The game is over.");
      return;
    }
    const piece = controller.pieceAt(cursor);
    const isTarget = selected && targets.some((t) => t.to === cursor);
    if (!isTarget && piece && piece.color === game.playerColor && cursor !== selected) {
      const count = controller.legalTargets(cursor).length;
      setCursorSpeech(`${pieceName(piece.type)} on ${cursor} selected, ${count} legal ${count === 1 ? "move" : "moves"}.`);
    } else if (!isTarget) {
      setCursorSpeech(selected ? "Selection cancelled." : `${describeCursor(cursor)}. Not one of your pieces.`);
    }
    handleTap(cursor);
  };

  const submitTypedMove = (text: string): string | null => {
    if (replay) return "You are replaying an earlier move. Press End to return to the game first.";
    if (!controller.canMove()) return "Wait for your turn.";
    const move = controller.parseMove(text);
    if (!move) return `"${text.trim()}" is not a legal move here. Try e4, Nf3, O-O, or e2e4 (add q, r, b or n to promote).`;
    void controller.playerMove(move.from, move.to, move.promotion);
    setSelection(null);
    setMoveInputOpen(false);
    boardRef.current?.focus();
    return null;
  };

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || isTypingTarget(e.target)) return;
    if (settingsOpen || newGameOpen || shortcutsOpen) return; // Dialogs own the keyboard.
    const key = e.key;
    const lower = key.toLowerCase();

    if ((e.metaKey || e.ctrlKey) && !e.altKey && lower === "z") {
      e.preventDefault();
      undo();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (promotion) {
      const piece = ({ q: "q", r: "r", b: "b", n: "n" } as Record<string, PieceSymbol>)[lower];
      if (piece) {
        e.preventDefault();
        choosePromotion(piece);
      } else if (key === "Escape") {
        e.preventDefault();
        setPromotion(null);
      }
      return;
    }

    if (key === "Escape") {
      e.preventDefault();
      if (replay) goLive();
      else if (selected) {
        setSelection(null);
        setCursorSpeech("Selection cancelled.");
      } else setShortcutsOpen(true);
      return;
    }
    if (key === "?") {
      e.preventDefault();
      setShortcutsOpen(true);
      return;
    }

    if (key.startsWith("Arrow")) {
      e.preventDefault();
      if (e.shiftKey) {
        const scene = sceneRef.current;
        if (key === "ArrowLeft") scene?.orbitBy(-ORBIT_STEP, 0);
        if (key === "ArrowRight") scene?.orbitBy(ORBIT_STEP, 0);
        if (key === "ArrowUp") scene?.orbitBy(0, -TILT_STEP);
        if (key === "ArrowDown") scene?.orbitBy(0, TILT_STEP);
      } else {
        moveCursor(key);
      }
      return;
    }

    if (key === "Enter" || key === " ") {
      // Buttons and links keep their own Enter and Space.
      const target = e.target as HTMLElement | null;
      if (target && target !== document.body && !boardRef.current?.contains(target)) return;
      e.preventDefault();
      activateCursor();
      return;
    }

    if (key === "Home") {
      e.preventDefault();
      if (game.history.length) setView((v) => ({ ply: 0, seq: (v?.seq ?? 0) + 1, animate: true }));
      return;
    }
    if (key === "End") {
      e.preventDefault();
      goLive();
      return;
    }

    const actions: Record<string, () => void> = {
      "/": () => setMoveInputOpen(true),
      n: () => setNewGameOpen(true),
      u: undo,
      h: () => {
        if (settings.mode === "training") void controller.hint();
      },
      m: () => updateSettings({ mode: settings.mode === "play" ? "training" : "play" }),
      s: () => setSettingsOpen(true),
      r: retry,
      t: () => controller.toggleThreat(),
      b: () => controller.toggleBest(),
      k: () => controller.keepMove(),
      "[": () => stepReplay(-1),
      "]": () => stepReplay(1),
      v: () => sceneRef.current?.resetView(),
      f: () => sceneRef.current?.flipView(),
      "+": () => sceneRef.current?.zoomBy(0.88),
      "=": () => sceneRef.current?.zoomBy(0.88),
      "-": () => sceneRef.current?.zoomBy(1.14),
      _: () => sceneRef.current?.zoomBy(1.14),
    };
    const action = actions[lower];
    if (action) {
      e.preventDefault();
      action();
    }
  });

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const onBoardFocus = (e: FocusEvent<HTMLDivElement>) => {
    // Only keyboard focus shows the cursor; a click also focuses the board.
    if (e.target === e.currentTarget && e.currentTarget.matches(":focus-visible") && !cursor) moveCursor("");
  };

  const training = settings.mode === "training";
  const over = game.status.kind !== "playing";
  const busy = game.thinking || game.reviewing || game.hintPending;
  const status = statusText(game);
  const lastPly = game.history.length - 1;
  const opponentLabel = `Stockfish ${settings.elo >= ELO_MAX ? "Max" : settings.elo}`;

  const gameSpeech = useMemo(() => {
    const parts: string[] = [];
    const last = game.history.at(-1);
    if (last) parts.push(`${last.color === game.playerColor ? "You" : "Opponent"} played ${sanToSpeech(last.san)}.`);
    if (game.review) {
      const a = game.review.annotation;
      parts.push(
        `Coach: ${CLASS_LABEL[a.cls]}. Your position went from ${formatScore(a.before)} to ${formatScore(a.after)}.`,
        "Press R to try again, T for the threat, B for the best move, or K to keep your move.",
      );
    } else if (game.feedback) {
      parts.push(`Coach: ${CLASS_LABEL[game.feedback.cls]}.`);
    }
    parts.push(`${status}.`);
    const record = game.ratingRecord;
    if (record) parts.push(`Your rating ${record.change >= 0 ? "rose" : "fell"} by ${Math.abs(record.change)} to ${record.rating}.`);
    return parts.join(" ");
  }, [game.history, game.playerColor, game.review, game.feedback, game.ratingRecord, status]);

  return (
    <div className="app" onPointerDown={unlockAudio}>
      <a className="skip-link" href="#board">
        Skip to board
      </a>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ♞
          </span>
          <span className="brand-name" role="heading" aria-level={1}>
            Chess Gym
          </span>
        </div>
        <Segmented
          label="Mode"
          value={settings.mode}
          onChange={(mode) => updateSettings({ mode })}
          options={MODE_OPTIONS}
        />
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-btn kbd-btn"
            aria-label="Keyboard shortcuts"
            aria-keyshortcuts="?"
            title="Keyboard shortcuts (?)"
            onClick={() => setShortcutsOpen(true)}
          >
            <IconKeyboard />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Settings"
            aria-keyshortcuts="S"
            onClick={() => setSettingsOpen(true)}
          >
            <IconGear />
          </button>
        </div>
      </header>

      <main className="stage" onPointerDown={() => setCursor(null)}>
        <div
          id="board"
          ref={boardRef}
          className="canvas-host"
          tabIndex={0}
          role="application"
          aria-roledescription="chess board"
          aria-label="Chess board"
          aria-describedby="board-help"
          onFocus={onBoardFocus}
        />
        <p id="board-help" className="sr-only">
          Use the arrow keys to move the cursor and Enter to pick up and drop a piece. Press slash to type a move,
          and question mark for every shortcut.
        </p>

        {training && settings.showEvalBar && (
          <EvalBar score={game.evaluation} bottom={game.playerColor} pending={game.reviewing && !game.evaluation} />
        )}

        <div className="status-row">
          <div className={`status-pill${over ? " is-over" : ""}`}>
            {busy && <span className="spinner" aria-hidden />}
            <span>{replay ? `Replaying move ${Math.floor(replay.ply / 2) + 1}` : status}</span>
          </div>
          {game.feedback && !replay && (
            <FeedbackChip key={game.feedback.id} cls={game.feedback.cls} san={game.feedback.san} />
          )}
        </div>

        {viewAdjusted && sceneReady && (
          <button
            type="button"
            className="view-reset"
            onClick={() => sceneRef.current?.resetView()}
            aria-keyshortcuts="V"
            title="Reset camera (V)"
          >
            <IconResetView />
            <span>Reset camera</span>
          </button>
        )}

        {promotion && (
          <PromotionPicker color={game.playerColor} onPick={choosePromotion} onCancel={() => setPromotion(null)} />
        )}

        {moveInputOpen && <MoveInput onSubmit={submitTypedMove} onClose={() => setMoveInputOpen(false)} />}

        {sceneState.status === "loading" && <div className="stage-message">Setting up the board</div>}
        {sceneState.status === "error" && (
          <div className="stage-message is-error">
            <strong>3D rendering is not available</strong>
            <span>{sceneState.message}</span>
          </div>
        )}
        {game.engineError && (
          <div className="stage-message is-error is-bottom">
            <strong>The engine could not start</strong>
            <span>Reload the page to try again.</span>
          </div>
        )}
        {sceneState.status === "ready" && (
          <span className="renderer-badge" title="Graphics backend in use">
            {sceneState.backend}
          </span>
        )}
      </main>

      <aside className="panel">
        <Clocks clock={game.clock} playerColor={game.playerColor} opponentLabel={opponentLabel} />

        <div className="panel-info">
          <span>
            Your rating{" "}
            <strong>
              {rating.rating}
              {rating.games < PROVISIONAL_GAMES ? "?" : ""}
            </strong>
          </span>
          {game.ratingRecord ? (
            <span className={game.ratingRecord.change >= 0 ? "tone-best" : "tone-threat"}>
              {game.ratingRecord.change >= 0 ? "+" : ""}
              {game.ratingRecord.change} this game
            </span>
          ) : (
            <span className="muted">{game.rated ? "Rated game" : "Unrated"}</span>
          )}
        </div>

        {replayEntry && replay ? (
          <ReplayBanner
            entry={replayEntry}
            index={replay.ply}
            total={game.history.length}
            onPrev={() => stepReplay(-1)}
            onNext={() => stepReplay(1)}
            onLive={goLive}
          />
        ) : (
          game.review && (
            <CoachCard
              review={game.review}
              moveNumber={Math.floor(lastPly / 2) + 1}
              color={game.history[lastPly]?.color ?? game.playerColor}
              onRetry={retry}
              onToggleBest={() => controller.toggleBest()}
              onToggleThreat={() => controller.toggleThreat()}
              onKeep={() => controller.keepMove()}
            />
          )
        )}

        <MoveList history={game.history} viewed={replay ? replay.ply : null} onSelect={selectPly} />

        <nav className="actions" aria-label="Game actions">
          <button type="button" className="action" onClick={() => setNewGameOpen(true)} aria-keyshortcuts="N">
            <IconPlus />
            <span>New</span>
          </button>
          <button
            type="button"
            className="action"
            onClick={undo}
            disabled={game.history.length === 0}
            aria-keyshortcuts="U"
          >
            <IconUndo />
            <span>Undo</span>
          </button>
          {training && (
            <button
              type="button"
              className="action"
              onClick={() => void controller.hint()}
              disabled={!canMove || game.hintPending}
              aria-keyshortcuts="H"
            >
              <IconHint />
              <span>Hint</span>
            </button>
          )}
          <button
            type="button"
            className={`action${confirmResign ? " is-confirm" : ""}`}
            onClick={resign}
            onBlur={() => setConfirmResign(false)}
            disabled={over || game.history.length === 0}
          >
            <IconFlag />
            <span>{confirmResign ? "Confirm" : "Resign"}</span>
          </button>
        </nav>
      </aside>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {gameSpeech}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {cursorSpeech}
      </div>

      {settingsOpen && (
        <SettingsSheet
          settings={settings}
          backend={sceneReady ? sceneState.backend : null}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {newGameOpen && (
        <NewGameDialog
          initialColor={settings.playerColor}
          initialTimeControl={settings.timeControl}
          elo={settings.elo}
          mode={settings.mode}
          abandonsRatedGame={controller.isRatedInProgress()}
          onCancel={() => setNewGameOpen(false)}
          onStart={startGame}
        />
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
