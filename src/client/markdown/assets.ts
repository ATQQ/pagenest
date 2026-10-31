import type { DocumentModel } from "../../shared/contracts";

export type AssetDocument = Pick<DocumentModel, "id" | "path">;

export function resolveImageSource(
  source: string | undefined,
  document: AssetDocument | null,
): string {
  if (!source || !document) return source || "";
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(source)) return source;
  if (source.startsWith("/api/") || source.startsWith("/assets/")) return source;

  const pathname = source.split(/[?#]/, 1)[0] || "";
  let decodedPath = pathname;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    // Keep the original path when it contains an invalid escape sequence.
  }
  return `/api/assets/${encodeURIComponent(document.id)}?path=${encodeURIComponent(decodedPath)}`;
}
