export type ConnectionConfig = {
  host: string;
  port: number;
  timeoutSec: number;
  use: "tcp";
  path?: string;
  envVars?: Record<string, string>;
};

export type NodeHit = {
  key: Array<string | number>;
  data: string | null;
  defined: number;
};

export type LevelProfile = {
  depth: number;
  samples: number;
  subscriptKinds: Record<string, number>;
  examples: Array<string | number>;
  hasValue: number;
  hasChildren: number;
};

export type ValueProfile = {
  empty: number;
  numeric: number;
  json: number;
  delimited: number;
  other: number;
  delimiterGuess: string | null;
  pieceCountGuess: number | null;
  samples: string[];
};

export type GlobalProfile = {
  name: string;
  scannedNodes: number;
  truncated: boolean;
  maxDepth: number;
  levels: LevelProfile[];
  value: ValueProfile;
  sampleNodes: NodeHit[];
};

export type QueryFilter = {
  depth: number;
  op: "eq" | "neq" | "contains" | "prefix" | "gt" | "lt" | "gte" | "lte";
  value: string;
};

export type QueryPlan = {
  global: string;
  filters?: QueryFilter[];
  groupBy?: number[];
  metric?: {
    fn: "count" | "sum" | "avg" | "min" | "max";
    piece?: number;
    delimiter?: string;
  };
  limit?: number;
};

export type QueryResult = {
  columns: string[];
  rows: Array<Array<string | number | null>>;
  scanned: number;
  truncated: boolean;
};

export interface YdbDriver {
  mode: "mock" | "tcp";
  connected: boolean;
  label: string;
  connect(cfg: ConnectionConfig): Promise<void>;
  disconnect(): Promise<void>;
  listGlobals(): Promise<string[]>;
  get(global: string, key: Array<string | number>): Promise<string | null>;
  nextSubscript(
    global: string,
    key: Array<string | number>,
  ): Promise<string | number | null>;
  walk(
    global: string,
    seed: Array<string | number>,
    opts: { maxNodes: number; multilevel: boolean },
  ): Promise<NodeHit[]>;
}
