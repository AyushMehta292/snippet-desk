export type Settings = {
  minCpm: number;
  maxCpm: number;
  minMistakePer100: number;
  maxMistakePer100: number;
  tabSize: number;
  expandTrigger: "immediate" | "tab";
};

export const DEFAULT_SETTINGS: Settings = {
  minCpm: 280,
  maxCpm: 620,
  minMistakePer100: 0,
  maxMistakePer100: 2,
  tabSize: 4,
  expandTrigger: "immediate",
};

export function normalizeSnippetBody(body: string) {
  return body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function parseSnippet(input: unknown) {
  if (!input || typeof input !== "object") return { error: "Missing snippet." as const };
  const record = input as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const shortcut = typeof record.shortcut === "string" ? record.shortcut : "";
  const body = typeof record.body === "string" ? normalizeSnippetBody(record.body) : "";
  if (name.length < 1 || name.length > 80) return { error: "Give the snippet a name up to 80 characters." as const };
  if (!/^\S{2,40}$/.test(shortcut)) {
    return { error: "Shortcut must be 2–40 characters with no spaces." as const };
  }
  if (body.length < 1 || body.length > 200_000) {
    return { error: "Snippet text is required and must stay under 200,000 characters." as const };
  }
  return { value: { name, shortcut, body } };
}

function numberIn(value: unknown, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < min || parsed > max) return null;
  return parsed;
}

export function parseSettings(input: unknown): { value: Settings } | { error: string } {
  if (!input || typeof input !== "object") return { error: "Missing settings." };
  const record = input as Record<string, unknown>;
  const minCpm = numberIn(record.minCpm, 30, 12000);
  const maxCpm = numberIn(record.maxCpm, 30, 12000);
  const minMistakePer100 = numberIn(record.minMistakePer100, 0, 40);
  const maxMistakePer100 = numberIn(record.maxMistakePer100, 0, 40);
  const tabSize = numberIn(record.tabSize, 1, 8);
  const expandTrigger = record.expandTrigger === "tab" || record.expandTrigger === "immediate" ? record.expandTrigger : null;
  if (minCpm == null || maxCpm == null || minCpm > maxCpm) {
    return { error: "Typing speed needs a slowest and fastest pace, from 30 to 12,000 characters per minute." };
  }
  if (minMistakePer100 == null || maxMistakePer100 == null || minMistakePer100 > maxMistakePer100) {
    return { error: "Mistake frequency needs a minimum and maximum between 0 and 40 per 100 characters." };
  }
  if (tabSize == null || expandTrigger == null) return { error: "Tab size or expansion trigger is invalid." };
  return {
    value: {
      minCpm: Math.round(minCpm),
      maxCpm: Math.round(maxCpm),
      minMistakePer100,
      maxMistakePer100,
      tabSize: Math.round(tabSize),
      expandTrigger,
    },
  };
}

export function settingsFromRow(row: {
  min_cpm: number;
  max_cpm: number;
  min_mistake_per_100: number;
  max_mistake_per_100: number;
  tab_size: number;
  expand_trigger: string;
} | undefined): Settings {
  if (!row) return DEFAULT_SETTINGS;
  const parsed = parseSettings({
    minCpm: row.min_cpm,
    maxCpm: row.max_cpm,
    minMistakePer100: row.min_mistake_per_100,
    maxMistakePer100: row.max_mistake_per_100,
    tabSize: row.tab_size,
    expandTrigger: row.expand_trigger,
  });
  return "value" in parsed ? parsed.value : DEFAULT_SETTINGS;
}

export function prefixWarning(shortcut: string, others: string[]) {
  for (const other of others) {
    if (other === shortcut) continue;
    if (other.startsWith(shortcut) || shortcut.startsWith(other)) {
      return `“${shortcut}” overlaps “${other}”. The longer shortcut wins, and immediate expansion can fire before the longer one is finished.`;
    }
  }
  return null;
}
