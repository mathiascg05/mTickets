import { db } from "./db";

export function useStorageUrl(path: string | undefined | null): string | undefined {
  const { data } = db.useQuery(
    path ? { $files: { $: { where: { path } } } } : null,
  );
  return data?.$files[0]?.url;
}
