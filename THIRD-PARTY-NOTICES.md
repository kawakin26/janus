# 第三者ライセンス表記（THIRD-PARTY NOTICES）

Janus 本体のコードは MIT License（ルートの `LICENSE` を参照）で公開しています。本ファイルは、
Janus が **同梱（再配布）** または **依存** する第三者ソフトウェアと、そのライセンスを明示するものです。
各第三者コンポーネントには、Janus の MIT ライセンスではなく、**それぞれの元のライセンス**が適用されます。

MIT ライセンスの文言は Janus 自身の著作物に対するものであり、下記の同梱物・依存物には各自のライセンスが
適用されます。

---

## 1. 同梱（ソースツリーに再配布しているもの）

リポジトリに実ファイルを含めて再配布しているコンポーネント。各ディレクトリに元の LICENSE / NOTICE を同梱
しています。

### draw.io / diagrams.net
- 用途: 作図の閲覧ビューア（GraphViewer）と編集 Web アプリ（embed）をセルフホスト同梱。
- バージョン: v32.0.2（無改変で再配布）
- ライセンス: Apache License 2.0
- 著作権: Copyright 2005-2024 JGraph Ltd, draw.io AG
- 出典: https://github.com/jgraph/drawio
- 同梱場所: `frontend/public/drawio/`（ライセンス全文 `frontend/public/drawio/LICENSE`、帰属表記
  `frontend/public/drawio/NOTICE`）
- 備考: 配布物（`viewer/`・`webapp/js/` 配下の各ファイル）は公式リリースから無改変で同梱しています。
  `webapp/js/PreConfig.js` および `webapp/js/PostConfig.js` は Janus 側で追加したオフライン設定ファイルで、
  draw.io 本体の改変ではありません。JGraph Ltd / draw.io AG による推奨（endorsement）を含意しません。

### ezjww（JWW/Jw_cad リーダ・WebAssembly ビルド）
- 用途: JWW ファイルのブラウザ内パース（CAD→SVG 変換）。
- ライセンス: MIT License
- 出典: https://github.com/monozukuri-ai/ezjww （タグ v0.3.4 / クレート `ezjww-wasm` 0.2.10）
- 同梱場所: `frontend/src/vendor/ezjww-web/`（ライセンス全文 `frontend/src/vendor/ezjww-web/LICENSE`、
  ビルド元の記録 `frontend/src/vendor/ezjww-web/SOURCE.md`）
- 備考: `wasm-pack --target web` で自ビルドした成果物（`.wasm` + グルー JS）を同梱しています。

---

## 2. 依存（パッケージマネージャ経由で取得。ソースは同梱していない）

ビルド・実行時に取得する依存。配布形態によっては成果物に含まれます。主要なもののライセンスを示します
（推移的依存を含む完全な一覧は各パッケージマネージャの出力を参照してください）。

### フロントエンド（npm, `frontend/package.json`）

| パッケージ | ライセンス | 用途 |
|---|---|---|
| react, react-dom | MIT | UI フレームワーク |
| react-router-dom | MIT | ルーティング |
| react-markdown | MIT | Markdown レンダリング |
| remark-gfm | MIT | GFM 拡張 |
| remark-directive | MIT | ディレクティブ記法（`:::custom-map` / `:::drawio`） |
| unist-util-visit | MIT | AST 走査 |
| dxf-parser | MIT | DXF ファイルのパース（CAD→SVG 変換） |
| vite, vitest, typescript, eslint ほか（開発依存） | MIT ほか | ビルド・テスト・静的検査 |

### バックエンド（pip, `backend/requirements.txt`）

| パッケージ | ライセンス | 用途 |
|---|---|---|
| Django | BSD-3-Clause | Web フレームワーク |
| djangorestframework | BSD-3-Clause | REST API |
| django-cors-headers | MIT | CORS 制御 |
| dj-database-url | BSD-3-Clause | DB 接続 URL 解析 |
| asgiref | BSD-3-Clause | ASGI 参照実装（推移依存） |
| sqlparse | BSD-3-Clause | SQL パース（推移依存） |

---

## 3. ライセンス互換性に関する補足

Janus 本体の MIT License は、上記の Apache-2.0 / BSD-3-Clause / MIT の各コンポーネントと互換性があります
（いずれも寛容ライセンスで、強いコピーレフトの感染性はありません）。同梱している Apache-2.0 の draw.io は、
Apache-2.0 のまま再配布しており、Janus の MIT ライセンスに再ライセンスしているわけではありません。

本表記は便宜のための整理であり、法的助言ではありません。再配布・商用利用にあたっては各ライセンス原文を
確認してください。
