export type DocumentExtension = ".md" | ".markdown" | ".mdown";

export interface DocumentModel {
  id: string;
  path: string;
  title: string;
  markdown: string;
  updatedAt: number;
  size: number;
  hash: string;
}

export interface VersionSummary {
  id: string;
  docId: string;
  createdAt: number;
  reason: string;
  charDelta: number;
  hash: string;
  size: number;
}

export interface VersionDetail extends VersionSummary {
  markdown: string;
}

export interface GitignoreStatus {
  exists: boolean;
  ruleCount: number;
}

export interface Settings {
  ignorePatterns: string[];
  cliIgnorePatterns: string[];
  gitignore: GitignoreStatus;
}

export interface BootstrapResponse {
  version: 1;
  rootName: string;
  documentCount: number;
  versionLimit: number;
  documents: DocumentModel[];
  versions: Record<string, VersionSummary[]>;
  settings: Settings;
}

export interface SearchResult {
  id: string;
  path: string;
  title: string;
  updatedAt: number;
  hash: string;
  snippet: string;
  line: number;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
}

export interface SaveDocumentRequest {
  markdown: string;
  baseHash: string;
  force?: boolean;
}

export interface SaveDocumentResponse {
  doc: DocumentModel;
  versions: VersionSummary[];
  saved: boolean;
}

export interface CreateDocumentRequest {
  path: string;
  title?: string;
  markdown?: string;
}

export interface CreateDocumentResponse {
  doc: DocumentModel;
  versions: VersionSummary[];
}

export interface RestoreVersionResponse {
  doc: DocumentModel;
  versions: VersionSummary[];
  restored: boolean;
  sourceVersion: VersionDetail;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: unknown;
  };
}

export interface DocumentUpdatedEvent {
  id: string;
  path: string;
  hash: string;
  updatedAt: number;
}

export type DocumentCreatedEvent = DocumentUpdatedEvent;

export interface SettingsUpdatedEvent {
  settings: Settings;
}

export interface ApiEventMap {
  "document-updated": DocumentUpdatedEvent;
  "document-created": DocumentCreatedEvent;
  "settings-updated": SettingsUpdatedEvent;
}

export type ApiEventName = keyof ApiEventMap;
