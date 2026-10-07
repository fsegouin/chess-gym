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
import { getTimeControl } from "@/lib/clock";
import { CLASS_LABEL, formatScore, negate } from "@/lib/coach";
import type { Score } from "@/lib/engine";
import { GameController, type Arrow, type GameSnapshot } from "@/lib/game";
import { buildLesson, hasLessonData, lessonPace } from "@/lib/lesson";
import { PROVISIONAL_GAMES, useRating } from "@/lib/rating";
import { BoardScene } from "@/lib/scene/BoardScene";
import { ELO_MAX, getSettings, MODE_OPTIONS, updateSettings, useSettings } from "@/lib/settings";
import { playSound, renderPlacement, setSoundMaterial, unlockAudio } from "@/lib/sound";
import { pieceName, sanToSpeech, squareSpeech } from "@/lib/speech";
import { prefersDark, resolveTheme, THEMES, usePrefersDark } from "@/lib/themes";
import { Clocks } from "./Clocks";
import { CoachCard } from "./CoachCard";
import { EvalBar } from "./EvalBar";
import { FeedbackChip } from "./FeedbackChip";
import { GameOverCard } from "./GameOverCard";
import { IconFlag, IconGear, IconHint, IconKeyboard, IconPlus, IconResetView, IconUndo } from "./icons";
import { LessonPanel } from "./LessonPanel";
import { MoveInput } from "./MoveInput";
import { MoveList } from "./MoveList";
import { NewGameDialog } from "./NewGameDialog";
import type { GameOptions } from "./NewGameForm";
import { PromotionPicker } from "./PromotionPicker";
import { ReplayBanner } from "./ReplayBanner";
import { SettingsSheet } from "./SettingsSheet";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { StartScreen } from "./StartScreen";
import { Segmented } from "./ui";

type SceneState = { status: "loading" } | { status: "ready"; backend: string } | { status: "error"; message: string };

/** A ply being replayed from the move list; `seq` re-triggers the animation on a repeat click. */
type ReplayView = { ply: number; seq: number; animate: boolean };

/** Post-game coach review: a position in the lesson's steps. `seq` re-triggers the board. */
type LessonView = { index: number; playing: boolean; animate: boolean; seq: number };

/** What the board shows instead of the live game: a replayed move or a lesson step. */
type BoardOverride = {
  key: string;
  fen: string;
  /** Shown first so the move into `fen` can be animated. */
  prevFen: string | null;
  move: { from: Square; to: Square } | null;
  lastMove: { from: Square; to: Square } | null;
  arrows: Arrow[];
  /** Animation speed multiplier; above 1 while a review plays quiet moves quickly. */
  speed: number;
};

function uciArrow(uci: string, kind: Arrow["kind"]): Arrow {
  return { from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, kind };
}

const FILES = "abcdefgh";
const ORBIT_STEP = 0.2;
const TILT_STEP = 0.08;

function statusText(game: GameSnapshot): string {
  if (game.engineError) return "Engine unavailable";
  if (!game.started) return "Choose your game";
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

/** Before the first game, show the clocks the chosen time control would start with. */
function previewClock(controlId: string): GameSnapshot["clock"] {
  const control = getTimeControl(controlId);
  const start = control?.initialMs ?? 0;
  return { controlId, limited: control !== null, values: { w: start, b: start }, running: null, since: 0 };
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
  const [lessonView, setLessonView] = useState<LessonView | null>(null);

  // Undo can shorten the history under a replay; fall back to the live game then.
  const replay = view && view.ply < game.history.length ? view : null;
  const replayEntry = replay ? game.history[replay.ply] : null;

  const lessonActive = lessonView !== null;
  const lesson = useMemo(
    () => (lessonActive ? buildLesson(game.history, game.playerColor) : null),
    [lessonActive, game.history, game.playerColor],
  );
  const lessonStep = lesson && lessonView ? lesson.steps[Math.min(lessonView.index, lesson.steps.length - 1)] : null;

  const canMove = controller.canMove() && !replay && !lessonActive;
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
            (window as unknown as { __chess?: unknown }).__chess = { controller, scene: s, renderPlacement };
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

  const override = ((): BoardOverride | null => {
    const h = game.history;
    if (lessonStep && lessonView) {
      const key = `lesson-${lessonView.seq}`;
      const at = (ply: number) => ({ from: h[ply].from, to: h[ply].to });
      switch (lessonStep.kind) {
        case "intro":
          return { key, fen: h[0]?.before ?? game.fen, prevFen: null, move: null, lastMove: null, arrows: [], speed: 1 };
        case "move": {
          const e = h[lessonStep.ply];
          const move = at(lessonStep.ply);
          return {
            key,
            fen: e.after,
            prevFen: lessonView.animate ? e.before : null,
            move: lessonView.animate ? move : null,
            lastMove: move,
            arrows: [],
            speed: lessonView.playing && lesson ? lessonPace(lesson.steps, lessonView.index).speed : 1,
          };
        }
        case "teach": {
          // Stop before the move: what was played (orange) against what was better (green).
          const p = lessonStep.point;
          return {
            key,
            fen: h[lessonStep.ply].before,
            prevFen: null,
            move: null,
            lastMove: lessonStep.ply > 0 ? at(lessonStep.ply - 1) : null,
            arrows: [uciArrow(p.playedUci, "played"), uciArrow(p.bestUci, "best")],
            speed: 1,
          };
        }
        case "summary": {
          const last = h.length - 1;
          return {
            key,
            fen: h[last]?.after ?? game.fen,
            prevFen: null,
            move: null,
            lastMove: last >= 0 ? at(last) : null,
            arrows: [],
            speed: 1,
          };
        }
      }
    }
    if (replay && replayEntry) {
      const move = { from: replayEntry.from, to: replayEntry.to };
      const a = replayEntry.annotation;
      const showBest = a?.bestUci && a.cls !== "best" && a.cls !== "good";
      return {
        key: `replay-${replay.seq}`,
        fen: replayEntry.after,
        prevFen: replay.animate ? replayEntry.before : null,
        move: replay.animate ? move : null,
        lastMove: move,
        arrows: showBest ? [uciArrow(a.bestUci!, "best")] : [],
        speed: 1,
      };
    }
    return null;
  })();

  // Primitive keys keep the board effects from re-running on unrelated game updates.
  const overrideKey = override?.key ?? null;
  const overrideFen = override?.fen ?? null;
  const overridePrev = override?.prevFen ?? null;
  const overrideMove = override?.move ? `${override.move.from}${override.move.to}` : null;
  const overrideLast = override?.lastMove ? `${override.lastMove.from}${override.lastMove.to}` : null;
  const overrideSpeed = override?.speed ?? 1;
  const overrideArrowsKey = override ? JSON.stringify(override.arrows) : null;
  const overrideArrows = useMemo(
    () => (overrideArrowsKey ? (JSON.parse(overrideArrowsKey) as Arrow[]) : []),
    [overrideArrowsKey],
  );

  // An override is shown once per key: a speed change (play/pause) or a live update underneath
  // must not replay its move.
  const showOverride = useEffectEvent((scene: BoardScene) => {
    if (!overrideFen) return;
    if (overridePrev) scene.setPosition(overridePrev);
    const move = overrideMove ? { from: overrideMove.slice(0, 2) as Square, to: overrideMove.slice(2, 4) as Square } : null;
    scene.setPosition(overrideFen, move, overrideSpeed);
  });

  useEffect(() => {
    const scene = sceneRef.current;
    if (sceneReady && scene && overrideKey) showOverride(scene);
  }, [sceneReady, overrideKey]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (sceneReady && scene && !overrideKey) scene.setPosition(game.fen, game.animate);
  }, [sceneReady, overrideKey, game.positionId, game.fen, game.animate]);

  useEffect(() => {
    sceneRef.current?.setHighlights(
      overrideFen
        ? {
            selected: null,
            targets: [],
            lastMove: overrideLast
              ? { from: overrideLast.slice(0, 2) as Square, to: overrideLast.slice(2, 4) as Square }
              : null,
            check: null,
            arrows: overrideArrows,
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
    overrideFen,
    overrideLast,
    overrideArrows,
  ]);

  // Before Start the board and clocks follow the colour chosen in Settings (White when random).
  const viewSide = game.started ? game.playerColor : settings.playerColor === "b" ? "b" : "w";

  useEffect(() => {
    if (sceneReady) sceneRef.current?.setOrientation(viewSide);
  }, [sceneReady, viewSide]);

  useEffect(() => {
    if (sceneReady) sceneRef.current?.setTheme(theme);
  }, [sceneReady, theme]);

  useEffect(() => {
    if (sceneReady) sceneRef.current?.setQuality(settings.quality);
  }, [sceneReady, settings.quality]);

  useEffect(() => {
    controller.refresh();
  }, [controller, settings.mode, settings.pauseOn, settings.elo]);

  // Pieces sound like what they are made of.
  useEffect(() => {
    setSoundMaterial(theme.finish.pieces);
  }, [theme]);

  // The page background and browser chrome follow the board theme.
  useEffect(() => {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(theme.ui)) root.style.setProperty(`--${key}`, value);
    root.dataset.scheme = theme.scheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.ui.bg);
  }, [theme]);

  const goLive = useCallback(() => setView(null), []);

  const selectPly = (ply: number) => {
    if (lesson && lessonView) {
      // Jump the lesson to that move, stopping at its teaching moment if it has one.
      const index = lesson.steps.findIndex((s) => (s.kind === "teach" || s.kind === "move") && s.ply === ply);
      if (index >= 0) setLessonView({ index, playing: false, animate: true, seq: lessonView.seq + 1 });
      return;
    }
    setView((v) => ({ ply, seq: (v?.seq ?? 0) + 1, animate: true }));
  };

  const startLesson = () => {
    setView(null);
    setSelection(null);
    setLessonView({ index: 0, playing: false, animate: false, seq: 0 });
  };

  const lessonGo = (delta: number) => {
    if (!lesson || !lessonView) return;
    const last = lesson.steps.length - 1;
    const index = Math.max(0, Math.min(last, lessonView.index + delta));
    if (index === lessonView.index) return;
    // Leaving the intro starts the playback; reaching the end stops it.
    // Leaving the intro starts playback; going back or reaching the end stops it.
    const playing = lessonView.index === 0 && delta > 0 ? true : index === last || delta < 0 ? false : lessonView.playing;
    setLessonView({ index, playing, animate: delta > 0, seq: lessonView.seq + 1 });
    const step = lesson.steps[index];
    if (delta > 0 && step.kind === "move" && settings.sound) {
      const entry = game.history[step.ply];
      const san = entry.san;
      const piece = (/^[KQRBN]/.test(san) ? san[0].toLowerCase() : "p") as PieceSymbol;
      const finalMove = step.ply === game.history.length - 1 && game.status.kind !== "playing";
      playSound(
        san.endsWith("#") || finalMove
          ? "end"
          : san.includes("+")
            ? "check"
            : san.startsWith("O-O")
              ? "castle"
              : san.includes("x")
                ? "capture"
                : "move",
        { piece, to: entry.to },
      );
    }
  };

  const toggleLessonPlay = () => {
    if (lessonView) setLessonView({ ...lessonView, playing: !lessonView.playing });
  };

  const advanceLesson = useEffectEvent(() => lessonGo(1));
  const lessonStepKind = lessonStep?.kind;
  const lessonPlaying = lessonView?.playing ?? false;
  const lessonIndex = lessonView?.index;
  // A primitive: every emit rebuilds the history and the lesson, which must not restart the timer.
  const lessonDelay =
    lessonStepKind === "move" && lesson && lessonView ? lessonPace(lesson.steps, lessonView.index).delayMs : 1100;

  // While playing, replayed moves advance on their own; teaching moments wait for Next.
  useEffect(() => {
    if (!lessonPlaying || lessonStepKind !== "move") return;
    const id = window.setTimeout(() => advanceLesson(), lessonDelay);
    return () => window.clearTimeout(id);
  }, [lessonPlaying, lessonStepKind, lessonIndex, lessonDelay]);

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
      if (promotion || lessonActive) return;
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
    [controller, promotion, selected, replay, goLive, lessonActive],
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
    setLessonView(null);
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

  const startGame = ({ mode, color, elo, timeControl }: GameOptions) => {
    // Settings first: the controller reads mode and strength when the game starts.
    updateSettings({ mode, elo, playerColor: color, timeControl });
    controller.newGame(color, timeControl);
    setLessonView(null);
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
    // Before the first game only help, settings, the mode switch and the camera apply.
    const cameraKey = (e.shiftKey && e.key.startsWith("Arrow")) || ["v", "f", "+", "=", "-", "_"].includes(e.key.toLowerCase());
    if (!game.started && !cameraKey && !["?", "escape", "s", "m"].includes(e.key.toLowerCase())) return;
    const key = e.key;
    const lower = key.toLowerCase();

    if ((e.metaKey || e.ctrlKey) && !e.altKey && lower === "z") {
      e.preventDefault();
      undo();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (lessonView) {
      const onPageOrBoard = !e.target || e.target === document.body || boardRef.current?.contains(e.target as Node);
      const lessonKeys: Record<string, () => void> = {
        ArrowRight: () => lessonGo(1),
        ArrowLeft: () => lessonGo(-1),
        p: toggleLessonPlay,
        Escape: () => setLessonView(null),
        Home: startLesson,
      };
      // Enter and Space also step forward, unless a focused button should get them.
      if ((key === "Enter" || key === " ") && onPageOrBoard) lessonKeys[key] = () => lessonGo(1);
      const action = e.shiftKey ? undefined : (lessonKeys[key] ?? lessonKeys[lower]);
      if (action) {
        e.preventDefault();
        action();
        return;
      }
      // Help and camera keys still work during the review; nothing else touches the game.
      if (!cameraKey && key !== "?") return;
    }

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

  const newGameDefaults: GameOptions = {
    mode: settings.mode,
    color: settings.playerColor,
    elo: settings.elo,
    timeControl: settings.timeControl,
  };
  const startChoices = [
    { label: "Mode", value: settings.mode === "training" ? "Training" : "Rated" },
    { label: "Colour", value: { w: "White", b: "Black", random: "Random" }[settings.playerColor] },
    { label: "Opponent", value: `Stockfish ${settings.elo >= ELO_MAX ? "Max" : settings.elo}` },
    { label: "Time", value: settings.timeControl === "none" ? "Unlimited" : settings.timeControl.replace("+", " + ") },
  ];
  const training = settings.mode === "training";
  const over = game.status.kind !== "playing";
  const busy = game.thinking || game.reviewing || game.hintPending;
  const status = statusText(game);
  const lastPly = game.history.length - 1;
  const opponentStrength = settings.elo >= ELO_MAX ? "Max" : String(settings.elo);

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

  const lessonSpeech = (() => {
    if (!lessonStep) return null;
    if (lessonStep.kind === "teach") {
      const p = lessonStep.point;
      return `${p.label}. ${p.title}. ${p.text} Press Next to continue.`;
    }
    if (lessonStep.kind === "move") {
      const e = game.history[lessonStep.ply];
      return `${e.color === game.playerColor ? "You" : "Opponent"} played ${sanToSpeech(e.san)}.`;
    }
    if (lessonStep.kind === "summary") return "Review complete.";
    return "Coach review. Press Enter to start.";
  })();

  const lessonPly = lessonStep && (lessonStep.kind === "move" || lessonStep.kind === "teach") ? lessonStep.ply : null;

  // During the review the bar follows the coach's grade nearest to the step, from White's side.
  const lessonEval = ((): Score | null => {
    if (!lessonStep || lessonStep.kind === "intro") return null;
    const upTo = lessonStep.kind === "summary" ? game.history.length - 1 : lessonStep.ply;
    for (let ply = upTo; ply >= 0; ply--) {
      const entry = game.history[ply];
      const a = entry.annotation;
      if (!a) continue;
      // A teaching stop shows the position before the move, so use the grade's "before".
      const score = lessonStep.kind === "teach" && ply === lessonStep.ply ? a.before : a.after;
      return entry.color === "w" ? score : negate(score);
    }
    return null;
  })();
  // Wait for the coach to finish grading the final move, so the lesson cannot shift mid-review.
  const canReview = over && !game.reviewing && hasLessonData(game.history, game.playerColor);

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
          <EvalBar score={lessonActive ? lessonEval : game.evaluation} bottom={game.playerColor} pending={game.reviewing && !game.evaluation} />
        )}

        <div className="status-row">
          <div className={`status-pill${over ? " is-over" : ""}`}>
            {busy && <span className="spinner" aria-hidden />}
            <span>
              {lessonActive ? "Coach review" : replay ? `Replaying move ${Math.floor(replay.ply / 2) + 1}` : status}
            </span>
          </div>
          {game.feedback && !replay && !lessonActive && (
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

        {!game.started && sceneReady && (
          <StartScreen
            choices={startChoices}
            onStart={() => startGame(newGameDefaults)}
            onCustomize={() => setSettingsOpen(true)}
          />
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
      </main>

      <aside className="panel">
        <Clocks
          clock={game.started ? game.clock : previewClock(settings.timeControl)}
          playerColor={viewSide}
          opponentStrength={opponentStrength}
        />

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
            <span className="muted">{!game.started ? "Not started" : game.rated ? "Rated game" : "Unrated"}</span>
          )}
        </div>

        {lesson && lessonView && lessonStep ? (
          <LessonPanel
            lesson={lesson}
            step={lessonStep}
            index={lessonView.index}
            history={game.history}
            playing={lessonView.playing}
            onPrev={() => lessonGo(-1)}
            onNext={() => lessonGo(1)}
            onTogglePlay={toggleLessonPlay}
            onRestart={startLesson}
            onExit={() => setLessonView(null)}
            onNewGame={() => {
              setLessonView(null);
              setNewGameOpen(true);
            }}
          />
        ) : over && !replay && !game.review ? (
          <GameOverCard
            result={status}
            ratingRecord={game.ratingRecord}
            canReview={canReview}
            onReview={startLesson}
            onNewGame={() => setNewGameOpen(true)}
          />
        ) : replayEntry && replay ? (
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

        <MoveList history={game.history} viewed={lessonPly ?? (replay ? replay.ply : null)} onSelect={selectPly} />

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
        {lessonSpeech ?? gameSpeech}
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
          initial={newGameDefaults}
          abandonsRatedGame={controller.isRatedInProgress()}
          onCancel={() => setNewGameOpen(false)}
          onStart={startGame}
        />
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
