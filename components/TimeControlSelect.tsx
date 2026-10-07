import { useId } from "react";
import { TIME_CONTROLS, type TimeCategory, type TimeControl } from "@/lib/clock";

const CATEGORIES: TimeCategory[] = ["Bullet", "Blitz", "Rapid", "Classical"];

/** Short enough to show in full inside the select on a 360px screen. */
function optionLabel(c: TimeControl): string {
  const minutes = c.initialMs / 60_000;
  const bonus = c.incrementMs / 1000;
  return `${minutes} min${bonus ? ` + ${bonus} s bonus` : ""} · ${c.category}`;
}

export function TimeControlSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        Time control
      </label>
      <select id={id} className="select" aria-describedby={`${id}-help`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="none">No limit (clocks count up)</option>
        {CATEGORIES.map((category) => (
          <optgroup key={category} label={category}>
            {TIME_CONTROLS.filter((c) => c.category === category).map((c) => (
              <option key={c.id} value={c.id}>
                {optionLabel(c)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <small id={`${id}-help`} className="muted">
        The first number is each player&apos;s total time in minutes. The second is a bonus in seconds added
        to your clock after every move you make; it is not a limit per move. You lose when your total runs
        out.
      </small>
    </div>
  );
}
