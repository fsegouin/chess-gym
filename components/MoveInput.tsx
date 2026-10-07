"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

interface Props {
  /** Returns an error message, or null when the move was played. */
  onSubmit: (text: string) => string | null;
  onClose: () => void;
}

export function MoveInput({ onSubmit, onClose }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const message = onSubmit(text);
    if (message) setError(message);
  };

  return (
    <form className="move-input" onSubmit={submit} role="search" aria-label="Type a move">
      <label htmlFor={id} className="move-input-label">
        Your move
      </label>
      <input
        ref={ref}
        id={id}
        value={text}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="e4, Nf3, O-O, e2e4"
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
        onBlur={(e) => {
          if (!e.currentTarget.form?.contains(e.relatedTarget as Node)) onClose();
        }}
      />
      <button type="submit" className="btn btn-primary" onMouseDown={(e) => e.preventDefault()}>
        Play
      </button>
      {error && (
        <p id={`${id}-error`} className="move-input-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
