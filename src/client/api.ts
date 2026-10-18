import type {
  ApiErrorBody,
  BootstrapResponse,
  CreateDocumentRequest,
  CreateDocumentResponse,
  DocumentModel,
  RestoreVersionResponse,
  SaveDocumentResponse,
  SearchResponse,
  Settings,
  VersionDetail,
  VersionSummary,
} from "../shared/contracts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(
    message: string,
    {
      status = 0,
      code = "REQUEST_FAILED",
      details = null,
    }: { status?: number; code?: string; details?: unknown } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(
  path: string,
  { method = "GET", body, signal }: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("无法连接 PageNest 服务，请确认终端进程仍在运行。");
  }

  const payload = (await response.json().catch(() => null)) as
    (ApiErrorBody & Record<string, unknown>) | null;
  if (!response.ok) {
    throw new ApiError(payload?.error?.message || `请求失败（${response.status}）`, {
      status: response.status,
      code: payload?.error?.code || "REQUEST_FAILED",
      details: payload?.error?.details ?? null,
    });
  }
  return payload as T;
}

export const api = {
  bootstrap: (signal?: AbortSignal) => request<BootstrapResponse>("/api/bootstrap", { signal }),
  document: (docId: string, signal?: AbortSignal) =>
    request<{ doc: DocumentModel; versions: VersionSummary[] }>(
      `/api/docs/${encodeURIComponent(docId)}`,
      { signal },
    ),
  saveDocument: (docId: string, body: { markdown: string; baseHash: string; force?: boolean }) =>
    request<SaveDocumentResponse>(`/api/docs/${encodeURIComponent(docId)}`, {
      method: "PUT",
      body,
    }),
  createDocument: (body: CreateDocumentRequest) =>
    request<CreateDocumentResponse>("/api/docs", { method: "POST", body }),
  listVersions: (docId: string) =>
    request<{ versions: VersionSummary[] }>(`/api/docs/${encodeURIComponent(docId)}/versions`),
  readVersion: (docId: string, versionId: string) =>
    request<{ version: VersionDetail }>(
      `/api/docs/${encodeURIComponent(docId)}/versions/${encodeURIComponent(versionId)}`,
    ),
  restoreVersion: (docId: string, versionId: string) =>
    request<RestoreVersionResponse>(
      `/api/docs/${encodeURIComponent(docId)}/versions/${encodeURIComponent(versionId)}/restore`,
      { method: "POST" },
    ),
  search: (query: string, signal?: AbortSignal) =>
    request<SearchResponse>(`/api/search?q=${encodeURIComponent(query)}`, { signal }),
  settings: () => request<{ settings: Settings }>("/api/settings"),
  updateSettings: (ignorePatterns: string[]) =>
    request<{ settings: Settings }>("/api/settings", {
      method: "PUT",
      body: { ignorePatterns },
    }),
};
