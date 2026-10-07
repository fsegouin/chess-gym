"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PieceSymbol, Square } from "chess.js";
import { GameController, type GameSnapshot } from "@/lib/game";
import { BoardScene } from "@/lib/scene/BoardScene";
import { ELO_MAX, getSettings, MODE_OPTIONS, updateSettings, useSettings } from "@/lib/settings";
import { unlockAudio } from "@/lib/sound";
import { prefersDark, resolveTheme, THEMES, usePrefersDark } from "@/lib/themes";
import { CoachCard } from "./CoachCard";
import { EvalBar } from "./EvalBar";
import { FeedbackChip } from "./FeedbackChip";
import { IconCamera, IconGear, IconHint, IconPlus, IconUndo } from "./icons";
import { MoveList } from "./MoveList";
import { NewGameDialog } from "./NewGameDialog";
import { PromotionPicker } from "./PromotionPicker";
import { SettingsSheet } from "./SettingsSheet";
import { Segmented } from "./ui";

type SceneState = { status: "loading" } | { status: "ready"; backend: string } | { status: "error"; message: string };

function statusText(game: GameSnapshot): string {
  if (game.engineError) return "Engine unavailable";
  const s = game.status;
  if (s.kind === "checkmate") return s.winner === game.playerColor ? "Checkmate. You win" : "Checkmate. You lose";
  if (s.kind === "draw") return s.reason === "stalemate" ? "Stalemate. Draw" : `Draw by ${s.reason}`;
  if (game.review) return "Review your move";
  if (game.reviewing) return "Coach is reviewing";
  if (game.thinking) return "Opponent is thinking";
  if (game.hintPending) return "Looking for a hint";
  if (game.turn !== game.playerColor) return "Opponent to move";
  return game.checkSquare ? "Check. Your move" : "Your move";
}

export default function ChessApp() {
  const settings = useSettings();
  const theme = THEMES[resolveTheme(settings.theme, usePrefersDark())];
  const [controller] = useState(() => new GameController());
  const game = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<BoardScene | null>(null);
  const [sceneState, setSceneState] = useState<SceneState>({ status: "loading" });
  const sceneReady = sceneState.status === "ready";

  // A selection only lives as long as the position it was made in.
  const [selection, setSelection] = useState<{ square: Square; positionId: number } | null>(null);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newGameOpen, setNewGameOpen] = useState(false);

  const canMove = controller.canMove();
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
    const host = stageRef.current!;
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

  useEffect(() => {
    if (sceneReady) sceneRef.current?.setPosition(game.fen, game.animate);
  }, [sceneReady, game.positionId, game.fen, game.animate]);

  useEffect(() => {
    sceneRef.current?.setHighlights({
      selected,
      targets: settings.showLegalMoves ? targets : [],
      lastMove: settings.showLastMove ? game.lastMove : null,
      check: game.checkSquare,
      arrows: game.arrows,
    });
  }, [sceneReady, selected, targets, settings.showLegalMoves, settings.showLastMove, game.lastMove, game.checkSquare, game.arrows]);

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
  }, [controller, settings.mode, settings.pauseOn]);

  // The page background and browser chrome follow the board theme.
  useEffect(() => {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(theme.ui)) root.style.setProperty(`--${key}`, value);
    root.dataset.scheme = theme.scheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.ui.bg);
  }, [theme]);

  const handleTap = useCallback(
    (square: Square | null) => {
      unlockAudio();
      if (promotion) return;
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
    [controller, promotion, selected],
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSelection(null);
      setPromotion(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const training = settings.mode === "training";
  const over = game.status.kind !== "playing";
  const busy = game.thinking || game.reviewing || game.hintPending;
  const status = statusText(game);
  const lastPly = game.history.length - 1;

  return (
    <div className="app" onPointerDown={unlockAudio}>
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
        <button type="button" className="icon-btn" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
          <IconGear />
        </button>
      </header>

      <main className="stage">
        <div ref={stageRef} className="canvas-host" role="group" aria-label="Chess board, 3D view" />

        {training && settings.showEvalBar && (
          <EvalBar score={game.evaluation} bottom={game.playerColor} pending={game.reviewing && !game.evaluation} />
        )}

        <div className="status-row">
          <div className={`status-pill${over ? " is-over" : ""}`} role="status" aria-live="polite">
            {busy && <span className="spinner" aria-hidden />}
            <span>{status}</span>
          </div>
          {game.feedback && <FeedbackChip key={game.feedback.id} cls={game.feedback.cls} san={game.feedback.san} />}
        </div>

        {promotion && (
          <PromotionPicker color={game.playerColor} onPick={choosePromotion} onCancel={() => setPromotion(null)} />
        )}

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
        {game.review && (
          <CoachCard
            review={game.review}
            moveNumber={Math.floor(lastPly / 2) + 1}
            color={game.history[lastPly]?.color ?? game.playerColor}
            onRetry={() => controller.retry()}
            onToggleBest={() => controller.toggleBest()}
            onToggleThreat={() => controller.toggleThreat()}
            onKeep={() => controller.keepMove()}
          />
        )}

        <div className="panel-info">
          <span>
            Opponent <strong>{settings.elo >= ELO_MAX ? "Max" : settings.elo}</strong>
          </span>
          <span className="dot-sep" aria-hidden />
          <span>You play {game.playerColor === "w" ? "White" : "Black"}</span>
        </div>

        <MoveList history={game.history} />

        <nav className="actions" aria-label="Game actions">
          <button type="button" className="action" onClick={() => setNewGameOpen(true)}>
            <IconPlus />
            <span>New</span>
          </button>
          <button type="button" className="action" onClick={() => controller.undo()} disabled={game.history.length === 0}>
            <IconUndo />
            <span>Undo</span>
          </button>
          {training && (
            <button
              type="button"
              className="action"
              onClick={() => void controller.hint()}
              disabled={!canMove || game.hintPending}
            >
              <IconHint />
              <span>Hint</span>
            </button>
          )}
          <button type="button" className="action" onClick={() => sceneRef.current?.resetView()} disabled={!sceneReady}>
            <IconCamera />
            <span>View</span>
          </button>
        </nav>
      </aside>

      {settingsOpen && (
        <SettingsSheet settings={settings} backend={sceneReady ? sceneState.backend : null} onClose={() => setSettingsOpen(false)} />
      )}
      {newGameOpen && (
        <NewGameDialog
          initial={settings.playerColor}
          elo={settings.elo}
          onCancel={() => setNewGameOpen(false)}
          onStart={(playerColor) => {
            updateSettings({ playerColor });
            controller.newGame(playerColor);
            setSelection(null);
            setNewGameOpen(false);
          }}
        />
      )}
    </div>
  );
}
