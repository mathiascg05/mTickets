"use client";

import PhoneInput from "react-phone-number-input";
import flags from "react-phone-number-input/flags";
import "react-phone-number-input/style.css";

const inputClass =
  "w-full px-4 py-2.5 bg-field border border-border rounded-lg focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30 transition-colors";

export default function PhoneField({
  value,
  onChange,
  placeholder,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
}) {
  return (
    <PhoneInput
      id={id}
      international
      flags={flags}
      defaultCountry="VE"
      value={value || undefined}
      onChange={(v) => onChange(v ?? "")}
      placeholder={placeholder}
      numberInputProps={{ className: inputClass }}
      className="flex items-center gap-2"
    />
  );
}
