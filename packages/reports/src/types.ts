import type {
  Artifact,
  FileChange,
  Finding,
  SessionRecord,
  SessionStats,
  SessionStatus,
  UnfinishedItem,
} from '@stillwatch/schema';

export type ReportOptions = {
  now?: number;
  /** The user's home directory, to display paths with `~`. */
  home?: string | null;
};

export type SummaryInput = {
  session: SessionRecord;
  status: SessionStatus;
  stats: SessionStats | null;
  findings: Finding[];
  fileChanges: FileChange[];
  artifacts: Artifact[];
  unfinished: UnfinishedItem[];
};

export type DescribeOptions = { base?: string | null; home?: string | null };
