import type { Key, T } from "./i18n";

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
const TB = GB * 1024;

/** Binary units. */
export function bytes(n: number, digits?: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n === 0) return "0 B";
  if (n < KB) return `${n} B`;
  if (n < MB) return `${(n / KB).toFixed(digits ?? 1)} KB`;
  if (n < GB) return `${(n / MB).toFixed(digits ?? 1)} MB`;
  if (n < TB) return `${(n / GB).toFixed(digits ?? 1)} GB`;
  return `${(n / TB).toFixed(digits ?? 2)} TB`;
}

export function count(n: number): string {
  return n.toLocaleString("en-US");
}

export const CATEGORY_KEY = {
  video: "cat.video",
  image: "cat.image",
  audio: "cat.audio",
  aiModel: "cat.aiModel",
  archive: "cat.archive",
  document: "cat.document",
  code: "cat.code",
  system: "cat.system",
  other: "cat.other",
} as const;

export function pct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

const DAY = 86_400;

/** "Today", "18 days", "7 months", "1.4 years". */
export function unusedFor(lastUsed: number | null, now: number, t: T): string {
  if (lastUsed == null) return t("age.unknown");
  const days = Math.max(0, now - lastUsed) / DAY;
  if (days < 1) return t("age.today");
  if (days < 2) return t("age.yesterday");
  if (days < 31) return t("age.days", { n: Math.round(days) });
  const months = days / 30.4375;
  if (months < 12) {
    const m = Math.round(months);
    return m <= 1 ? t("age.month") : t("age.months", { n: m });
  }
  return t("age.years", { n: (days / 365.25).toFixed(1) });
}

/** The same age spelled out, for tooltips. */
export function unusedLong(lastUsed: number | null, now: number, t: T): string {
  if (lastUsed == null) return t("tip.unknown");
  const days = Math.max(0, Math.floor((now - lastUsed) / DAY));
  if (days === 0) return t("age.today");
  if (days < 31) return days === 1 ? t("age.day") : t("age.days", { n: days });
  const months = Math.floor(days / 30.4375);
  const remDays = Math.max(0, days - Math.floor(months * 30.4375));
  if (months < 12) {
    const head = months === 1 ? t("age.month") : t("age.months", { n: months });
    return remDays ? `${head} ${t("age.days", { n: remDays })}` : head;
  }
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  const head = years === 1 ? t("age.year") : t("age.years", { n: years });
  if (!remMonths) return head;
  return `${head} ${remMonths === 1 ? t("age.month") : t("age.months", { n: remMonths })}`;
}


/** `2026-09-05 11:47`. Fixed width in a monospace face, and sorts as it reads. */
export function dateTime(t: number | null): string {
  if (t == null) return "—";
  const d = new Date(t * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}

/** Date only, for the tree's coarser column. */
export function dateOnly(t: number | null): string {
  if (t == null) return "—";
  const d = new Date(t * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dateTimeLong(at: number | null, lang: string): string {
  if (at == null) return "—";
  return new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(at * 1000));
}

/** Idle-age bucket, which picks the age-bar colour. */
export type AgeBucket =
  | "fresh"
  | "week"
  | "month"
  | "quarter"
  | "half"
  | "year"
  | "ancient"
  | "unknown";

export function ageBucket(lastUsed: number | null, now = Date.now() / 1000): AgeBucket {
  if (lastUsed == null) return "unknown";
  const days = Math.max(0, now - lastUsed) / DAY;
  if (days < 7) return "fresh";
  if (days < 30) return "week";
  if (days < 91) return "month";
  if (days < 182) return "quarter";
  if (days < 365) return "half";
  if (days < 730) return "year";
  return "ancient";
}

export const AGE_COLOR: Record<AgeBucket, string> = {
  fresh: "var(--age-fresh)",
  week: "var(--age-week)",
  month: "var(--age-month)",
  quarter: "var(--age-quarter)",
  half: "var(--age-half)",
  year: "var(--age-year)",
  ancient: "var(--age-ancient)",
  unknown: "rgba(255,255,255,0.12)",
};

/** 0..1 fill for the age bar. Two years fills it. */
export function ageFraction(lastUsed: number | null, now = Date.now() / 1000): number {
  if (lastUsed == null) return 0;
  const days = Math.max(0, now - lastUsed) / DAY;
  return Math.min(1, Math.log2(days + 1) / Math.log2(731));
}

export function sourceLabel(s: string, t: T): string {
  switch (s) {
    case "spotlight":
      return t("tip.spotlight");
    case "fileSystemAccessTime":
      return t("tip.fsAtime");
    default:
      return t("tip.unknown");
  }
}

export function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export const CATEGORY_COLOR: Record<string, string> = {
  video: "#6678ff",
  image: "#a76bff",
  audio: "#df70c6",
  archive: "#ef8277",
  aiModel: "#5cc6b2",
  document: "#71a7f4",
  code: "#77c989",
  system: "#69717d",
  other: "#8e8e98",
};

/** Same order as the Rust `Category` enum, for Treemap's numeric `cat`. */
export const CATEGORY_BY_INDEX = [
  "video",
  "image",
  "audio",
  "archive",
  "aiModel",
  "document",
  "code",
  "system",
  "other",
] as const;

/** Category label in the active language, from the numeric or string form. */
export function categoryLabel(cat: string, t: T): string {
  const key = (CATEGORY_KEY as Record<string, Key>)[cat];
  return key ? t(key) : cat;
}

export function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}
