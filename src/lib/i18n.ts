import { createContext, useContext } from "react";

export type Lang = "en" | "ja";
export type LangSetting = "auto" | Lang;

export function resolveLang(setting: LangSetting): Lang {
  if (setting !== "auto") return setting;
  const nav = typeof navigator !== "undefined" ? navigator.language : "en";
  return nav.toLowerCase().startsWith("ja") ? "ja" : "en";
}

const en = {
  "app.scan": "Scan",
  "app.stop": "Stop",
  "app.rescan": "Rescan",
  "app.settings": "Settings",
  "app.done": "Done",
  "app.cancel": "Cancel",
  "app.clear": "Clear",

  "vol.select": "Select volume",
  "vol.pick": "Choose a volume to scan",
  "vol.free": "free",
  "vol.readonly": "read-only",
  "vol.none": "No volume",

  "search.files": "Search — size:>5GB unused:>6m *.mov",
  "search.types": "Filter extensions",

  "drive.used": "USED",
  "drive.free": "FREE",
  "drive.analyzed": "ANALYZED",
  "drive.scanned": "SCANNED",
  "drive.files": "FILES",

  "mode.tree": "Tree",
  "mode.hogs": "Space Hogs",
  "mode.types": "File Types",
  "tree.expand": "Expand {n}",
  "tree.collapse": "Collapse",
  "treemap.show": "Treemap",
  "treemap.whole": "Whole volume",
  "treemap.title": "TREEMAP",
  "treemap.lastUsed": "Last used: {v}",
  "treemap.ago": "{v} ago",
  "treemap.unknown": "Unknown",
  "treemap.folder": "Folder",
  "treemap.nFiles": "{n} files",
  "treemap.empty": "Nothing to show here.",
  "treemap.afterScan": "The Treemap fills in after a scan.",

  "hog.largestFirst": "Largest First",
  "hog.longestUnused": "Longest Unused",
  "hog.largestAndUnused": "Largest + Unused",
  "hog.recentlyUsed": "Recently Used",
  "hog.recentlyModified": "Recently Modified",
  "hog.title.largestFirst": "BIGGEST ITEMS",
  "hog.title.longestUnused": "LONGEST UNUSED",
  "hog.title.largestAndUnused": "LARGEST + UNUSED",
  "hog.title.recentlyUsed": "RECENTLY USED",
  "hog.title.recentlyModified": "RECENTLY MODIFIED",
  "hog.note": "ranked by size weighted by how long untouched",

  "filter.all": "All",
  "filter.size1G": "> 1 GB",
  "filter.size5G": "> 5 GB",
  "filter.size10G": "> 10 GB",
  "filter.unused3m": "Unused 3m+",
  "filter.unused6m": "Unused 6m+",
  "filter.unused1y": "Unused 1y+",
  "filter.unused2y": "Unused 2y+",

  "col.name": "Name",
  "col.pctParent": "% Parent",
  "col.size": "Size",
  "col.allocated": "Allocated",
  "col.files": "Files",
  "col.folders": "Folders",
  "col.lastUsed": "Last Used",
  "col.unusedFor": "Unused For",
  "col.modified": "Modified",
  "col.created": "Created",
  "col.extension": "Extension",
  "col.path": "Path",
  "col.kind": "Kind",
  "col.cleanupScore": "Cleanup Score",
  "col.diskPct": "Disk %",
  "col.rank": "#",
  "col.category": "Category",
  "col.totalSize": "Total Size",
  "col.pctDrive": "% Drive",
  "col.averageSize": "Average Size",
  "col.largestFile": "Largest File",

  "cap.folders": "FOLDERS",
  "cap.files": "FILES",
  "cap.fileTypes": "FILE TYPES",
  "cap.items": "{n} items",
  "cap.extensions": "{n} extensions",
  "cap.matching": "matching “{q}”",
  "cap.driveWide": "{n} drive-wide",
  "cap.clickExt": "click an extension to see those files",

  "empty.noScan": "Nothing scanned yet",
  "empty.pressScan": "Pick a volume and press Scan.",
  "empty.noMatch": "Nothing matches",
  "empty.widen": "Try a wider filter, or clear the search.",
  "empty.noFilesHere": "This folder holds no files directly",
  "empty.openSub": "Open a subfolder on the left to see its contents.",
  "empty.noMatchFolder": "No matches in this folder",
  "empty.lookWide": "Clear the search, or look drive-wide in Space Hogs.",
  "empty.noTypes": "No file types to show.",

  "status.files": "files",
  "status.folders": "folders",
  "status.shown": "shown",
  "status.selected": "selected",
  "status.noScan": "No scan yet",
  "status.scanning": "Scanning {path} — {size} analyzed",
  "status.completed": "Scan completed in {t}",
  "status.stopped": "Scan stopped after {t}",
  "status.spotlight": "{n} usage dates from Spotlight",
  "status.reading": "reading usage metadata…",
  "status.skipped": "Skipped",
  "status.grantFda": "Grant Full Disk Access",
  "status.freed": "Freed {size}",
  "status.rescanRefresh": "rescan to refresh",
  "status.staleHint":
    "These items are in the Trash. The numbers above still describe the tree as it was scanned.",

  "menu.open": "Open",
  "menu.quickLook": "Quick Look",
  "menu.reveal": "Reveal in Finder",
  "menu.copyPath": "Copy Path",
  "menu.focusTreemap": "Focus in Treemap",
  "menu.zoomHere": "Zoom in here",
  "menu.trash": "Move to Trash",
  "menu.trashOne": "Move “{name}” to Trash",
  "menu.trashMany": "Move {n} items to Trash",
  "menu.immutable": "This belongs to macOS and cannot be moved to the Trash",

  "trash.titleOne": "Move “{name}” to Trash?",
  "trash.titleMany": "Move {n} items to Trash?",
  "trash.total": "{size} total",
  "trash.lastUsed": "Last used {v} ago",
  "trash.unknownUse": "Usage date unknown",
  "trash.andMore": "…and {n} more",
  "trash.blocked": "{n} items belong to macOS and will be skipped.",
  "trash.protected":
    "{n} items are inside a system or shared library folder. Applications may stop working without them.",
  "trash.recoverable": "Items go to the Trash and can be put back from the Finder.",
  "trash.moving": "Moving…",

  "set.language": "Language",
  "set.languageHint": "Auto follows the system language.",
  "set.auto": "Auto",
  "set.groupBundles": "Group bundle contents",
  "set.groupBundlesHint":
    "Show an app or a Photos library as one item in Space Hogs instead of thousands of pieces.",
  "set.sizeBasis": "Size basis",
  "set.sizeBasisHint":
    "Allocated is what the file occupies on disk. Logical is its length, which is larger for sparse, compressed and cloud-only files.",
  "set.allocated": "Allocated (on disk)",
  "set.logical": "Logical",
  "set.spotlight": "Read usage dates from Spotlight",
  "set.spotlightHint":
    "Asks Spotlight for kMDItemLastUsedDate on the largest {n} files after a scan. Without it, Unused For falls back to filesystem access time.",
  "set.fastScanner": "Fast macOS scanner",
  "set.fastScannerHint":
    "Reads a whole directory's metadata in one syscall. Falls back automatically if it disagrees with the portable scanner.",
  "set.symlinks": "Follow symbolic links",
  "set.symlinksHint": "Off by default. Following links double-counts space and can loop.",
  "set.crossVolumes": "Cross into other volumes",
  "set.crossVolumesHint":
    "Off by default. When off, a scan stays inside the selected volume and skips other mounted disks.",
  "set.fda": "Full Disk Access",
  "set.fdaGranted": "Granted. Every readable folder is being scanned.",
  "set.fdaMissingN": "Not granted. {n} folders were skipped in the last scan.",
  "set.fdaMissing": "Not granted. Some folders will be skipped.",
  "set.openSettings": "Open Settings",
  "set.scannerUsed": "Last scan used the {name} scanner.",

  "tip.lastUsed": "Last used",
  "tip.unused": "Unused",
  "tip.source": "Source",
  "tip.unknown": "Unknown",
  "tip.spotlight": "Spotlight metadata",
  "tip.fsAtime": "Estimated from filesystem access time",
  "tip.score":
    "Review priority {n} of 100 — large and long untouched. Not a deletion recommendation.",
  "tip.cloud": "Stored in iCloud, using no local space",
  "tip.protected": "Part of the system or a shared library. Review, do not clear out.",
  "tip.denied": "No permission to read this folder",
  "tip.bundle": "bundle",

  "cat.video": "Video",
  "cat.image": "Images",
  "cat.audio": "Audio",
  "cat.archive": "Archive",
  "cat.aiModel": "AI Model",
  "cat.document": "Documents",
  "cat.code": "Code",
  "cat.system": "System",
  "cat.other": "Other",

  "age.today": "Today",
  "age.yesterday": "Yesterday",
  "age.days": "{n} days",
  "age.day": "1 day",
  "age.month": "1 month",
  "age.months": "{n} months",
  "age.years": "{n} years",
  "age.year": "1 year",
  "age.unknown": "—",
};

export type Key = keyof typeof en;

const ja: Record<Key, string> = {
  "app.scan": "Scan",
  "app.stop": "Stop",
  "app.rescan": "再スキャン",
  "app.settings": "設定",
  "app.done": "完了",
  "app.cancel": "キャンセル",
  "app.clear": "クリア",

  "vol.select": "ボリュームを選択",
  "vol.pick": "スキャンするボリュームを選択",
  "vol.free": "空き",
  "vol.readonly": "読み出し専用",
  "vol.none": "ボリュームなし",

  "search.files": "検索 — size:>5GB unused:>6m *.mov",
  "search.types": "拡張子で絞り込み",

  "drive.used": "使用中",
  "drive.free": "空き",
  "drive.analyzed": "解析済み",
  "drive.scanned": "スキャン済み",
  "drive.files": "ファイル",

  "mode.tree": "Tree",
  "mode.hogs": "容量ランキング",
  "mode.types": "ファイル種別",
  "tree.expand": "{n}階層展開",
  "tree.collapse": "折りたたむ",
  "treemap.show": "Treemap",
  "treemap.whole": "ボリューム全体",
  "treemap.title": "Treemap",
  "treemap.lastUsed": "最終使用: {v}",
  "treemap.ago": "{v}前",
  "treemap.unknown": "不明",
  "treemap.folder": "フォルダ",
  "treemap.nFiles": "{n} ファイル",
  "treemap.empty": "表示するものがありません",
  "treemap.afterScan": "スキャン後に表示されます",

  "hog.largestFirst": "容量が大きい順",
  "hog.longestUnused": "長期間未使用順",
  "hog.largestAndUnused": "大容量かつ未使用",
  "hog.recentlyUsed": "最近使った順",
  "hog.recentlyModified": "最近変更した順",
  "hog.title.largestFirst": "容量が大きい順",
  "hog.title.longestUnused": "長期間未使用",
  "hog.title.largestAndUnused": "大容量かつ長期間未使用",
  "hog.title.recentlyUsed": "最近使ったもの",
  "hog.title.recentlyModified": "最近変更したもの",
  "hog.note": "容量と未使用期間を掛け合わせた優先度順",

  "filter.all": "すべて",
  "filter.size1G": "1 GB 超",
  "filter.size5G": "5 GB 超",
  "filter.size10G": "10 GB 超",
  "filter.unused3m": "3か月以上未使用",
  "filter.unused6m": "6か月以上未使用",
  "filter.unused1y": "1年以上未使用",
  "filter.unused2y": "2年以上未使用",

  "col.name": "名前",
  "col.pctParent": "親フォルダ比",
  "col.size": "サイズ",
  "col.allocated": "実使用量",
  "col.files": "ファイル",
  "col.folders": "フォルダ",
  "col.lastUsed": "最終使用",
  "col.unusedFor": "未使用期間",
  "col.modified": "変更日",
  "col.created": "作成日",
  "col.extension": "拡張子",
  "col.path": "パス",
  "col.kind": "種類",
  "col.cleanupScore": "優先度",
  "col.diskPct": "ディスク比",
  "col.rank": "#",
  "col.category": "カテゴリ",
  "col.totalSize": "合計サイズ",
  "col.pctDrive": "ドライブ比",
  "col.averageSize": "平均サイズ",
  "col.largestFile": "最大ファイル",

  "cap.folders": "フォルダ",
  "cap.files": "ファイル",
  "cap.fileTypes": "ファイル種別",
  "cap.items": "{n} 件",
  "cap.extensions": "{n} 種類",
  "cap.matching": "「{q}」に一致",
  "cap.driveWide": "全体では {n} 件",
  "cap.clickExt": "拡張子をクリックするとそのファイルを表示",

  "empty.noScan": "まだスキャンしていません",
  "empty.pressScan": "ボリュームを選んで Scan を押してください",
  "empty.noMatch": "一致するものがありません",
  "empty.widen": "条件を広げるか検索をクリアしてください",
  "empty.noFilesHere": "このフォルダに直接あるファイルはありません",
  "empty.openSub": "左のサブフォルダを開いて中身を確認してください",
  "empty.noMatchFolder": "このフォルダには一致するものがありません",
  "empty.lookWide": "検索をクリアするか、容量ランキングで全体を確認してください",
  "empty.noTypes": "表示するファイル種別がありません",

  "status.files": "ファイル",
  "status.folders": "フォルダ",
  "status.shown": "表示中",
  "status.selected": "選択中",
  "status.noScan": "未スキャン",
  "status.scanning": "Scan 中 {path} — {size} 解析済み",
  "status.completed": "Scan 完了 {t}",
  "status.stopped": "Scan 中止 {t}",
  "status.spotlight": "Spotlight から {n} 件の使用日時",
  "status.reading": "使用日時を読み込み中…",
  "status.skipped": "スキップ",
  "status.grantFda": "フルディスクアクセスを許可",
  "status.freed": "{size} 解放",
  "status.rescanRefresh": "再スキャンで更新",
  "status.staleHint": "これらはゴミ箱にあります。上の数値はスキャン時点のままです。",

  "menu.open": "開く",
  "menu.quickLook": "Quick Look",
  "menu.reveal": "Finder に表示",
  "menu.copyPath": "パスをコピー",
  "menu.focusTreemap": "ツリーマップで表示",
  "menu.zoomHere": "ここを拡大",
  "menu.trash": "ゴミ箱に入れる",
  "menu.trashOne": "「{name}」をゴミ箱に入れる",
  "menu.trashMany": "{n} 件をゴミ箱に入れる",
  "menu.immutable": "macOS の一部のため、ゴミ箱に移動できません",

  "trash.titleOne": "「{name}」をゴミ箱に入れますか？",
  "trash.titleMany": "{n} 件をゴミ箱に入れますか？",
  "trash.total": "合計 {size}",
  "trash.lastUsed": "最終使用 {v}前",
  "trash.unknownUse": "使用日時は不明",
  "trash.andMore": "…他 {n} 件",
  "trash.blocked": "{n} 件は macOS の一部のためスキップされます。",
  "trash.protected":
    "{n} 件はシステムまたは共有ライブラリ内にあります。削除するとアプリが動作しなくなる場合があります。",
  "trash.recoverable": "ゴミ箱に入るだけなので、Finder から元に戻せます。",
  "trash.moving": "移動中…",

  "set.language": "言語",
  "set.languageHint": "自動はシステムの言語設定に従います。",
  "set.auto": "自動",
  "set.groupBundles": "バンドルの中身をまとめる",
  "set.groupBundlesHint":
    "アプリや写真ライブラリを、中の数千個のファイルではなく 1 項目として表示します。",
  "set.sizeBasis": "サイズの基準",
  "set.sizeBasisHint":
    "実使用量はディスク上で占める容量。論理サイズはファイルの長さで、スパース・圧縮・クラウド専用ファイルでは大きくなります。",
  "set.allocated": "実使用量（ディスク上）",
  "set.logical": "論理サイズ",
  "set.spotlight": "Spotlight から使用日時を取得",
  "set.spotlightHint":
    "Scan 後、大きい方から {n} 件について kMDItemLastUsedDate を取得します。無効の場合、未使用期間はファイルシステムのアクセス日時にフォールバックします。",
  "set.fastScanner": "macOS 高速スキャナ",
  "set.fastScannerHint":
    "ディレクトリのメタデータを 1 回のシステムコールで取得します。汎用スキャナと結果が食い違う場合は自動的に切り替わります。",
  "set.symlinks": "シンボリックリンクをたどる",
  "set.symlinksHint": "既定はオフ。たどると容量が二重計上され、ループする可能性があります。",
  "set.crossVolumes": "他のボリュームにも入る",
  "set.crossVolumesHint":
    "既定はオフ。オフの場合、選択したボリューム内に留まり、他のディスクはスキップします。",
  "set.fda": "フルディスクアクセス",
  "set.fdaGranted": "許可済み。読み取り可能なすべてのフォルダを Scan します。",
  "set.fdaMissingN": "未許可。前回の Scan で {n} 個のフォルダをスキップしました。",
  "set.fdaMissing": "未許可。一部のフォルダはスキップされます。",
  "set.openSettings": "設定を開く",
  "set.scannerUsed": "前回の Scan では {name} スキャナを使用しました。",

  "tip.lastUsed": "最終使用",
  "tip.unused": "未使用期間",
  "tip.source": "取得元",
  "tip.unknown": "不明",
  "tip.spotlight": "Spotlight メタデータ",
  "tip.fsAtime": "ファイルシステムのアクセス日時からの推定",
  "tip.score": "確認優先度 {n}/100。大きく、長く使われていないもの。削除の推奨ではありません。",
  "tip.cloud": "iCloud 上にあり、ローカル容量を使っていません",
  "tip.protected": "システムまたは共有ライブラリの一部です。確認のうえ慎重に扱ってください。",
  "tip.denied": "このフォルダを読む権限がありません",
  "tip.bundle": "bundle",

  "cat.video": "動画",
  "cat.image": "画像",
  "cat.audio": "音声",
  "cat.archive": "アーカイブ",
  "cat.aiModel": "AI Model",
  "cat.document": "書類",
  "cat.code": "コード",
  "cat.system": "システム",
  "cat.other": "その他",

  "age.today": "今日",
  "age.yesterday": "昨日",
  "age.days": "{n}日",
  "age.day": "1日",
  "age.month": "1か月",
  "age.months": "{n}か月",
  "age.years": "{n}年",
  "age.year": "1年",
  "age.unknown": "—",
};

const TABLES: Record<Lang, Record<Key, string>> = { en, ja };

export type T = (key: Key, vars?: Record<string, string | number>) => string;

export function makeT(lang: Lang): T {
  const table = TABLES[lang];
  return (key, vars) => {
    let s = table[key] ?? en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    }
    return s;
  };
}

export interface I18n {
  lang: Lang;
  t: T;
}

export const I18nContext = createContext<I18n>({ lang: "en", t: makeT("en") });

export function useI18n(): I18n {
  return useContext(I18nContext);
}
