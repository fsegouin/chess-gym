import { useId } from "react";
import { TIME_CONTROLS, describeTimeControl, type TimeCategory } from "@/lib/clock";

const CATEGORIES: TimeCategory[] = ["Bullet", "Blitz", "Rapid", "Classical"];

export function TimeControlSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        Time control
      </label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="none">No limit (clocks count up)</option>
        {CATEGORIES.map((category) => (
          <optgroup key={category} label={category}>
            {TIME_CONTROLS.filter((c) => c.category === category).map((c) => (
              <option key={c.id} value={c.id}>
                {c.id.replace("+", " + ")} · {describeTimeControl(c.id)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
