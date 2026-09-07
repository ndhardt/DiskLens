# DiskLens

macOS 向けのディスク使用量アナライザ。何が容量を食っているかに加えて、
**どれくらい使っていないか** も一緒に見られます。

<!-- screenshot -->

## できること

- **ツリー** — 各階層で容量の大きい順。フォルダごとの合計・ファイル数・最終使用日
- **容量ランキング** — 階層を無視して、Mac 全体から大きいものを順に
- **ファイル種別** — 拡張子ごとの合計容量
- **ツリーマップ** — 容量を面積で表示。クリックで表と相互に選択が同期

Spotlight の `kMDItemLastUsedDate` から「最後に開いた日時」を取得するので、
`大容量かつ長期間未使用` を優先度順に並べられます。取得できない場合は
ファイルシステムのアクセス日時にフォールバックし、どちらを使ったかは
ツールチップに表示されます。

削除は必ずゴミ箱経由（`NSFileManager -trashItemAtURL:`）です。`/System`
`/usr` `/bin` `/sbin` `/private` は削除できません。

## 検索

スペース区切りは AND 条件です。

```
mov                  名前に含む
*.mov                グロブ
extension:mov        拡張子
size:>5GB            サイズ
unused:>6m           未使用期間
path:Downloads       パスに含む
kind:video           カテゴリ
size:>5GB unused:>6m
```

## ショートカット

| | |
|---|---|
| ⌘F | 検索 |
| ⌘R | 再スキャン |
| ⌘1 / ⌘2 / ⌘3 | ツリー / 容量ランキング / ファイル種別 |
| Space | クイックルック |
| ⌘O | 開く |
| ⌘⌫ | ゴミ箱に入れる |
| ⌘⌥C | パスをコピー |
| Esc | 選択解除 / ポップアップを閉じる |

## フルディスクアクセス

無くても起動します。読めないフォルダはスキップして件数をステータスバーに
出すだけで、スキャンは中断しません。すべて見たい場合は
**システム設定 ▸ プライバシーとセキュリティ ▸ フルディスクアクセス** に
DiskLens を追加してください。

## ビルド

Rust、Node 20+、Xcode Command Line Tools、Apple Silicon の macOS 14 以降が必要です。

```bash
npm install
npm run tauri dev      # 開発
npm run tauri build    # DiskLens.app
npm run dmg            # .dmg を作る
```

テストと計測:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo run --release --manifest-path src-tauri/Cargo.toml --example bench -- /Users
```

`npm run dev` だけならブラウザでダミーデータの UI が開きます（`src/lib/mock.ts`）。

## 構成

Tauri 2 / React / TypeScript / Rust。スキャン結果のインデックスは Rust 側に
置いたままで、UI は表示する行だけを要求します。ソート・絞り込み・集計・
ツリーマップのレイアウトはすべて Rust 側です。

ディレクトリの走査は macOS では `getattrlistbulk(2)` を使い、1 回の
システムコールでディレクトリ 1 つ分のメタデータをまとめて取得します
(`readdir` + `lstat` 版のおよそ 2 倍)。起動時に `lstat` と突き合わせて検証し、
食い違った場合は汎用スキャナに自動で切り替わります。

firmlink（`/Users` と `/System/Volumes/Data/Users` は同一）、APFS の
ボリュームグループ、ハードリンク、シンボリックリンク、iCloud の
ダウンロード未完了ファイルは、いずれも容量が二重計上されないように
処理しています。

## ライセンス

MIT。同梱の [Monaspace](https://monaspace.githubnext.com)（© GitHub）は
SIL Open Font License 1.1 で、ライセンス本文は `src/assets/fonts/` にあります。
