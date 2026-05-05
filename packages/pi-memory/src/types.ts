export type MemoryEntryStatus = "active" | "invalid";
export type MemoryScope = "global" | "project";
export type MemorySearchScope = MemoryScope | "all";
export type MemorySourceKind = "inbox" | "topic";

export interface LineSpan {
  start: number;
  end: number;
}

export interface MemoryWarning {
  code: string;
  message: string;
  filePath?: string;
  entryId?: string;
}

export interface MemoryConfig {
  agentDir: string;
  globalSettingsPath: string;
  projectSettingsPath: string;
  enabled: boolean;
  warnings: string[];
}

export interface ProjectIdentity {
  anchorPath: string;
  normalizedAnchor: string;
  projectId: string;
  slug: string;
  displayName: string;
  mode: "directory" | "git";
}

export interface MemoryRoots {
  agentDir: string;
  memoryDir: string;
  globalRoot: string;
  projectRoot: string;
  rootDirs: Record<MemoryScope, string>;
  inboxDirs: Record<MemoryScope, string>;
  topicDirs: Record<MemoryScope, string>;
}

export interface ParsedMetadataPair {
  key: string;
  normalizedKey: string;
  value: string;
}

export interface ParsedEntry {
  id: string;
  syntheticId: boolean;
  scope: MemoryScope;
  sourceKind: MemorySourceKind;
  filePath: string;
  heading: string;
  body: string;
  bodyText: string;
  status: MemoryEntryStatus;
  updated: string;
  updatedAt: number;
  metadata: Readonly<Record<string, string>>;
  metadataPairs: ParsedMetadataPair[];
  lineSpan: LineSpan;
  raw: string;
  rawStartOffset: number;
  rawEndOffset: number;
  afterHeadingOffset: number;
  bodyStartOffset: number;
  fileMtimeMs: number;
}

export interface ParsedMemoryFile {
  filePath: string;
  scope: MemoryScope;
  sourceKind: MemorySourceKind;
  preamble: string;
  entries: ParsedEntry[];
  warnings: MemoryWarning[];
  fileMtimeMs: number;
}

export interface MemorySearchRequest {
  query: string;
  maxResults?: number;
  scope?: MemorySearchScope;
}

export interface MemorySearchResult {
  id: string;
  syntheticId: boolean;
  scope: MemoryScope;
  filePath: string;
  heading: string;
  status: MemoryEntryStatus;
  updated: string;
  relativeAge: string;
  updatedLabel: string;
  excerpt: string;
  lineSpan: LineSpan;
}

export interface MemorySearchResponse {
  results: MemorySearchResult[];
  warnings: MemoryWarning[];
}

export interface MemoryWriteRequest {
  content: string;
  topic: string;
  scope?: MemoryScope;
  now?: Date;
}

export interface MemoryWritePlan {
  normalizedTopic: string;
  fileName: string;
  title: string;
  heading: string;
  body: string;
}

export interface MemoryWriteResult {
  entryId: string;
  filePath: string;
  scope: MemoryScope;
  heading: string;
  updated: string;
  createdTopic: boolean;
  topicFileName: string;
}

export interface MemoryMoveRequest {
  targetScope: MemoryScope;
  targetTopic?: string;
  now?: Date;
}

export interface MemoryMoveResult {
  entryId: string;
  sourceFilePath: string;
  sourceScope: MemoryScope;
  targetFilePath: string;
  targetScope: MemoryScope;
  heading: string;
  updated: string;
  createdTopic: boolean;
  targetTopicFileName: string;
  syntheticIdBackfilled: boolean;
}

export interface MemoryInvalidationResult {
  entryId: string;
  filePath: string;
  scope: MemoryScope;
  syntheticIdBackfilled: boolean;
  updated: string;
}

export interface OrientationSummary {
  totalTopics: number;
  topicNames: string[];
  text: string;
}

export interface MemoryStatusSummary {
  topicFileCount: number;
  lastModified: string | null;
  memoryDir: string;
  globalRoot: string;
  projectRoot: string;
}
