"use client";

import { useEffect, useState } from "react";
import type { Color } from "chess.js";
import { clockSpeech, formatClock } from "@/lib/clock";
import type { ClockSnapshot } from "@/lib/game";

const LOW_TIME_MS = 20_000;

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

interface Props {
  clock: ClockSnapshot;
  playerColor: Color;
  opponentLabel: string;
}

export function Clocks({ clock, playerColor, opponentLabel }: Props) {
  const now = useNow(clock.running !== null);
  const value = (color: Color) => {
    const base = clock.values[color];
    if (clock.running !== color) return base;
    const elapsed = Math.max(0, now - clock.since);
    return clock.limited ? Math.max(0, base - elapsed) : base + elapsed;
  };
  const opponent: Color = playerColor === "w" ? "b" : "w";
  const sides: { color: Color; label: string }[] = [
    { color: opponent, label: opponentLabel },
    { color: playerColor, label: "You" },
  ];
  return (
    <div className="clocks" role="group" aria-label={clock.limited ? "Clocks, time left" : "Clocks, time used"}>
      {sides.map(({ color, label }) => {
        const ms = value(color);
        const active = clock.running === color;
        const low = clock.limited && ms < LOW_TIME_MS;
        return (
          <div
            key={color}
            className={`clock${active ? " is-active" : ""}${low ? " is-low" : ""}`}
            aria-label={`${label}, ${color === "w" ? "White" : "Black"}: ${clockSpeech(ms)}${clock.limited ? " left" : " used"}`}
          >
            <span className="clock-label" aria-hidden>
              <span className={`clock-swatch is-${color}`} />
              {label}
            </span>
            <span className="clock-time" aria-hidden>
              {formatClock(ms, clock.limited)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
