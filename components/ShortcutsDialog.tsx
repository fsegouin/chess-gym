import { Fragment } from "react";
import { Dialog } from "./ui";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const GROUPS: { title: string; items: { keys: string[][]; label: string }[] }[] = [
  {
    title: "Board",
    items: [
      { keys: [["←"], ["↑"], ["→"], ["↓"]], label: "Move the cursor" },
      { keys: [["Enter"], ["Space"]], label: "Pick up or drop a piece" },
      { keys: [["/"]], label: "Type a move (e4, Nf3, e2e4)" },
      { keys: [["Q"], ["R"], ["B"], ["N"]], label: "Choose a promotion piece" },
      { keys: [["Esc"]], label: "Leave a replay, cancel the selection, or show this list" },
    ],
  },
  {
    title: "Game",
    items: [
      { keys: [["N"]], label: "New game" },
      { keys: [["U"], [IS_MAC ? "⌘" : "Ctrl", "Z"]], label: "Undo" },
      { keys: [["H"]], label: "Hint (training)" },
      { keys: [["M"]], label: "Switch between Play and Training" },
      { keys: [["P"]], label: "Your training: puzzles and patterns" },
      { keys: [["I"]], label: "Review a game played elsewhere (PGN)" },
      { keys: [["W"]], label: "Chess TV: watch a classic game" },
      { keys: [["S"]], label: "Settings" },
    ],
  },
  {
    title: "Chess TV",
    items: [
      { keys: [["→"], ["Enter"]], label: "Next move, or carry on after a key moment" },
      { keys: [["←"]], label: "Previous move" },
      { keys: [["P"], ["Space"]], label: "Play or pause" },
      { keys: [["Home"]], label: "Back to the start" },
      { keys: [["Esc"]], label: "Stop watching" },
    ],
  },
  {
    title: "Puzzles",
    items: [
      { keys: [["H"]], label: "Hint: which piece to move" },
      { keys: [["Enter"]], label: "Next puzzle, once solved" },
      { keys: [["Esc"]], label: "Leave practice" },
    ],
  },
  {
    title: "Coach review",
    items: [
      { keys: [["R"]], label: "Try again" },
      { keys: [["T"]], label: "Show the threat" },
      { keys: [["B"]], label: "Show the best move" },
      { keys: [["K"]], label: "Keep my move" },
    ],
  },
  {
    title: "Coach review (after a game)",
    items: [
      { keys: [["→"], ["Enter"], ["Space"]], label: "Next step" },
      { keys: [["←"]], label: "Previous step" },
      { keys: [["P"]], label: "Play or pause" },
      { keys: [["Home"]], label: "Restart the review" },
      { keys: [["Esc"]], label: "Leave the review" },
    ],
  },
  {
    title: "Replay",
    items: [
      { keys: [["["]], label: "Previous move" },
      { keys: [["]"]], label: "Next move" },
      { keys: [["Home"]], label: "Start of the game" },
      { keys: [["End"]], label: "Back to the current position" },
    ],
  },
  {
    title: "Camera",
    items: [
      { keys: [["V"]], label: "Reset the camera" },
      { keys: [["F"]], label: "Look from the other side" },
      { keys: [["Shift", "←"], ["Shift", "→"]], label: "Orbit around the board" },
      { keys: [["Shift", "↑"], ["Shift", "↓"]], label: "Tilt the camera" },
      { keys: [["+"], ["−"]], label: "Zoom in or out" },
    ],
  },
  {
    title: "Help",
    items: [{ keys: [["?"], ["Esc"]], label: "Show this list" }],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} variant="center" className="dialog-wide">
      <div className="shortcut-groups">
        {GROUPS.map((group) => (
          <section key={group.title} className="shortcut-group">
            <h3>{group.title}</h3>
            <dl>
              {group.items.map((item) => (
                <div key={item.label} className="shortcut-row">
                  <dt>
                    {item.keys.map((combo, i) => (
                      <Fragment key={i}>
                        <span className="shortcut-combo">
                          {i > 0 && <span className="shortcut-or">or</span>}
                          {combo.map((k, j) => (
                            <Fragment key={k}>
                              {j > 0 && <span className="shortcut-plus">+</span>}
                              <kbd>{k}</kbd>
                            </Fragment>
                          ))}
                        </span>
                      </Fragment>
                    ))}
                  </dt>
                  <dd>{item.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
