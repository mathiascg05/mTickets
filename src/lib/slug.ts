export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-") // replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, ""); // strip leading/trailing hyphens
}
