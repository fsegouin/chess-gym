"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconClose } from "./icons";

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  wide?: boolean;
}

export function Segmented<T extends string>({ label, value, options, onChange, wide }: SegmentedProps<T>) {
  return (
    <div className={`segmented${wide ? " is-wide" : ""}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? "is-active" : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface ToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Toggle({ label, description, checked, onChange }: ToggleProps) {
  const id = useId();
  return (
    <div className="toggle-row">
      <label htmlFor={id}>
        <span>{label}</span>
        {description && <small>{description}</small>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        className="switch"
        onClick={() => onChange(!checked)}
      >
        <span className="switch-thumb" />
      </button>
    </div>
  );
}

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  variant?: "sheet" | "center";
}

/** Modal surface: a bottom sheet on phones, a centered card on larger screens. */
export function Dialog({ title, onClose, children, variant = "sheet" }: DialogProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  // Callers pass inline callbacks; a new identity must not re-run the focus handling below.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className={`dialog dialog-${variant}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}
