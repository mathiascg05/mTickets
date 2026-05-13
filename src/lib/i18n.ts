export type Lang = "es" | "en";

type TFunc = (key: string, params?: Record<string, string | number>) => string;

// BCP-47 locales used for Intl date/number formatting based on the active UI language.
// Bolívar amounts always use es-VE regardless of UI language because that is how Venezuelans
// read VES values; only callers that format USD/EUR amounts should use this helper.
export function dateLocale(lang: Lang): string {
  return lang === "es" ? "es-ES" : "en-US";
}

export function numberLocale(lang: Lang): string {
  return lang === "es" ? "es-ES" : "en-US";
}

const FIELD_TYPE_KEYS: Record<string, string> = {
  text: "admin.fieldText",
  number: "admin.fieldNumber",
  checkbox: "admin.fieldCheckbox",
  date: "admin.fieldDate",
  email: "admin.fieldEmail",
  select: "admin.fieldSelect",
  multiselect: "admin.fieldMultiselect",
};

export function getFieldTypeLabel(fieldType: string, t: TFunc): string {
  const key = FIELD_TYPE_KEYS[fieldType];
  return key ? t(key) : fieldType;
}
