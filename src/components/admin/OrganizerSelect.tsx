"use client";

import { useEffect, useRef, useState } from "react";

export type OrganizerOption = {
  email: string;
  label: string;
  sublabel?: string;
  searchText: string;
};

const inputClass =
  "w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30";

export default function OrganizerSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (email: string) => void;
  options: OrganizerOption[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.email === value);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.searchText.toLowerCase().includes(q))
    : options;

  // When closed, show the selected label; when open, show what the user types.
  const displayValue = open ? query : selected?.label ?? "";

  function select(email: string) {
    onChange(email);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={displayValue}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        className={inputClass}
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto bg-surface border border-border rounded-lg shadow-lg">
          {value && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                select("");
              }}
              className="w-full text-left px-4 py-2 text-sm text-muted hover:bg-background/60"
            >
              --
            </button>
          )}
          {filtered.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">—</p>
          ) : (
            filtered.map((o) => (
              <button
                key={o.email}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(o.email);
                }}
                className={`w-full text-left px-4 py-2 hover:bg-background/60 transition-colors ${
                  o.email === value ? "bg-background/40" : ""
                }`}
              >
                <span className="block text-sm font-medium">{o.label}</span>
                {o.sublabel && (
                  <span className="block text-xs text-muted truncate">{o.sublabel}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
