"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Inline-edit field backed by local state. Typing updates only local state
 * (instant, no cursor jump); the value is persisted via `onCommit` on blur.
 *
 * Binding an input's `value` directly to an InstantDB query and writing on
 * every keystroke causes the async round-trip to overwrite the controlled
 * value mid-typing, which snaps the cursor to the end. Keeping a local copy
 * and only syncing from the prop when the field is NOT focused avoids that.
 */
export function InlineEditField({
  value,
  onCommit,
  multiline = false,
  placeholder,
  className,
  rows = 2,
}: {
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  rows?: number;
}) {
  const [local, setLocal] = useState(value);
  const focused = useRef(false);

  // Only sync from the prop while not editing, so an async InstantDB update
  // can't clobber the cursor or in-progress text.
  useEffect(() => {
    if (!focused.current) setLocal(value);
  }, [value]);

  const shared = {
    value: local,
    placeholder,
    className,
    onFocus: () => {
      focused.current = true;
    },
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => setLocal(e.target.value),
    onBlur: () => {
      focused.current = false;
      onCommit(local);
    },
  };

  return multiline ? <textarea {...shared} rows={rows} /> : <input {...shared} />;
}
