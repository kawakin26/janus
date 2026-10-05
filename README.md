# Janus

Janus は、GROWI の代替となる軽量なナレッジベースシステムです。非力なマシンや Android 端末でも動作することを目的とし、同一のフロントエンドで次の 2 つの運用形態を両立します。

- **ローカルモード**: 端末内で完結。サーバープロセス不要・root 不要。データは端末内（IndexedDB）に保存。主に Android 端末単体・個人利用を想定。*（フェーズ 3 で実装予定）*
- **サーバーモード**: Django + REST API による Web サーバー/クライアント方式。複数人・無制限のページ数・地図枚数に対応。*（本リポジトリの現在の実装対象）*

名前の由来は、二つの顔（ローカル / サーバー）を持つローマ神話の神 Janus です。

## 設計の中核方針

- フロントエンドは **1 つだけ** 実装する（React + TypeScript + PWA）。
- フロントが叩く **REST API の形を 1 つに統一** する。ローカルモードでは IndexedDB を読み書きする JS 実装が、サーバーモードでは Django のエンドポイントが、同じ API 契約（`StorageClient`）を満たす。
- 既存プラグイン（growi-plugin-custom-map）の地図ビューア / エディタのロジックを可能な限り流用する。
- **Elasticsearch は採用しない**（軽量・ローカル完結の方針と矛盾するため）。検索は軽量手段（SQLite FTS5 / ブラウザ内 N-gram）で段階的に実装する。

## リポジトリ構成（モノレポ）

```
janus/
├── backend/    # Django + Django REST Framework（サーバーモード）
├── frontend/   # React + Vite + TypeScript（PWA / 単一フロントエンド）
└── .kiro/      # 仕様（specs）・ステアリング
```

backend と frontend を 1 リポジトリに同居させています。フェーズ 3 で frontend を PWA 化し、同じ frontend をローカルモードでも配布します。

## 開発段階（フェーズ）

- **フェーズ 1**（完了）: サーバーモードの基盤。ページ CRUD、Markdown 表示、地図記法の表示、独立アセットライブラリ、認証・ユーザー管理、統一 API 契約の定義。
- **フェーズ 2**: 権限管理、リビジョン機能。
- **フェーズ 3**: コメント / メモ、draw.io 描画、CAD 自動変換、ローカルモード（PWA + IndexedDB）、地図 GUI 編集・現場写真添付。
- **フェーズ 4**: 全文検索（ローカル N-gram / サーバー FTS5）。

詳細は [`.kiro/specs/janus-foundation/`](.kiro/specs/janus-foundation/) を参照してください。

## 地図記法と独立アセット参照

アセットはページ添付ではなく、フォルダ階層を持つ独立ライブラリへ登録します。`filename`（短縮形 `file`）はファイル名、`aliasname`（短縮形 `alias`）は登録名を参照します。複数の指定子は記法上の出現順に解決され、先の指定子が見つからない場合に次を試します。`folder` は基準フォルダで、指定子の値に `/` が含まれる場合は基準フォルダからの相対パス、先頭が `/` の場合はルートからの絶対パスとして扱います。

```markdown
:::custom-map{folder="本館/2F" filename="floor.svg" aliasname="floor-plan" link="現場図面を開く"}

- x=18 y=26 label="入口" desc="受付"
  - alias="entrance.jpg" desc="入口写真"

:::
```

`filename` と `aliasname` の両方を指定した場合も、先に書いた指定子が優先されます。ファイル名または登録名が解決できない場合は、ビューアに「マップ/画像が見つかりません」と表示します。

### アセットライブラリ（フェーズ 1）

`/assets` はページから独立したアセット管理画面です。フォルダ直下の一覧、フォルダ作成、ファイル選択によるアップロード、alias の登録、返却 URL の確認を行えます。画面は `StorageClient` 契約だけを利用し、REST の具体実装には依存しません。

REST API の例:

```text
GET  /api/folders?parent=<folder-id>
GET  /api/assets?folder=<folder-id>
POST /api/folders              {"name":"本館","parentId":null}
POST /api/assets?folder=<folder-id>  multipart: file, alias
```

物理ファイルは不透明な ID でフラットに保存し、フォルダの親子関係と filename/alias はデータベースで管理します。将来のエクスポート時に DB の階層から論理ツリーを生成します。CAD から SVG への変換と GUI によるアセット移動はフェーズ 3 の境界であり、フェーズ 1 の画面には含めません。

サーバーモードは backend（API）と frontend（UI）の 2 プロセスで開発します。最小構成では backend は Python 1 プロセス + SQLite 1 ファイルで動き、root 不要・上位ポートで待受できます。

### サーバーモード backend（最小構成）

Python 1 プロセス + SQLite 1 ファイルで動作します（root 不要・上位ポートで待受）。Python 3.11+ が前提です。

```bash
cd backend
python -m venv ../.venv && source ../.venv/bin/activate   # 任意: 仮想環境
pip install -r requirements.txt
python manage.py migrate          # 未設定時は db.sqlite3（SQLite 単一ファイル）
DEBUG=true python manage.py runserver 8000
```

`migrate` で SQLite の単一ファイル（`backend/db.sqlite3`）が作成され、`runserver 8000` で `http://localhost:8000/api/` が待受します。

### フロントエンド（frontend）

Node.js 20 系 + npm を前提とします（開発確認は node v20 / npm 10 で実施）。

```bash
cd frontend
npm install          # 依存をインストール
npm run dev          # 開発サーバー（vite 既定 http://localhost:5173）
npm run build        # 本番ビルド（tsc -b && vite build → frontend/dist/ を生成）
npm run test:run     # テスト実行（vitest・一回実行）
npm run lint         # 静的検査（eslint）
```

`npm run dev` の開発サーバーは vite 既定で `http://localhost:5173` を待受します。`/api` へのリクエストは vite の **開発プロキシ**で backend（`http://localhost:8000`）へ転送されるため、開発中は CORS 設定を触らずに動きます（`frontend/vite.config.ts` の `server.proxy`）。このプロキシは開発サーバー専用で、`vite build` の本番成果物には影響しません。

### backend + frontend の 2 プロセス開発フロー

開発時はターミナルを 2 つ使い、backend と frontend を並行起動します。

```bash
# ターミナル 1: backend（API）
cd backend
DEBUG=true python manage.py runserver 8000

# ターミナル 2: frontend（UI）
cd frontend
npm run dev
```

ブラウザで `http://localhost:5173` を開くと UI が表示され、UI からの `/api` 呼び出しは vite プロキシ経由で `http://localhost:8000` の backend に届きます。

本番配信では frontend を `npm run build` した静的成果物（`frontend/dist/`）を任意の Web サーバーで配信し、別ホスト/ポートの backend を叩く構成が前提です。この場合は vite プロキシが無いため、backend 側で `JANUS_CORS_ALLOWED_ORIGINS` に配信元オリジンを設定して CORS を許可してください。

### 認証の使い方（最小）

API は既定で認証必須（`JANUS_REQUIRE_AUTH=true`）です。まず管理者ユーザーを作成します。

```bash
cd backend
../.venv/bin/python manage.py createsuperuser
```

認証方式は **トークン認証**です。`POST /api/auth/login` に `username` / `password` を送るとトークンが返り、以降のリクエストでは HTTP ヘッダ `Authorization: Token <トークン>` を付与します。フロントエンドの認証 UI も同じ契約でログイン・トークン保持を行います。

### 環境変数

`backend/.env.example` が設定項目のサンプルです。現状は `.env` の自動読込は行わないため、必要な変数は実行環境で `export` するか、コマンド前に付与してください（上記の `DEBUG=true` のように）。主な変数:

| 変数 | 既定 | 説明 |
|------|------|------|
| `SECRET_KEY` | ランダム生成 | Django 秘密鍵。本番では固定値を必ず設定 |
| `DEBUG` | `false` | デバッグモード。開発時のみ `true` |
| `ALLOWED_HOSTS` | 空（DEBUG 時は localhost） | 許可ホスト（カンマ区切り） |
| `DATABASE_URL` | SQLite（`backend/db.sqlite3`） | DB 接続 URL。PostgreSQL 利用時は別途 `psycopg` の導入が必要 |
| `JANUS_REQUIRE_AUTH` | `true` | 既定の API 権限を切替える。`true` で認証必須（`IsAuthenticated`）、`false` で誰でも可（`AllowAny`） |
| `JANUS_MEDIA_ROOT` | `backend/media/` | アセット保存先 |
| `JANUS_CORS_ALLOWED_ORIGINS` | 空（許可なし） | CORS 許可オリジン（カンマ区切り） |

## ライセンス

Janus 本体のコードは [MIT License](LICENSE) で公開しています。

本リポジトリには、第三者ソフトウェアを同梱（再配布）および依存として利用しています。これらには Janus の
MIT ライセンスではなく、それぞれの元のライセンスが適用されます（draw.io は Apache-2.0、ezjww は MIT など）。
詳細は [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) を参照してください。
