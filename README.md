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

- **フェーズ 1**（現在）: サーバーモードの基盤。ページ CRUD、Markdown 表示、地図記法の表示、認証・ユーザー管理、統一 API 契約の定義。
- **フェーズ 2**: 権限管理、リビジョン機能。
- **フェーズ 3**: コメント / メモ、draw.io 描画、CAD 自動変換、ローカルモード（PWA + IndexedDB）、地図 GUI 編集・現場写真添付。
- **フェーズ 4**: 全文検索（ローカル N-gram / サーバー FTS5）。

詳細は [`.kiro/specs/janus-foundation/`](.kiro/specs/janus-foundation/) を参照してください。

## セットアップ

> 起動手順・環境変数の詳細は実装進行に合わせて追記していきます（タスク 12 で最終整備予定）。

### サーバーモード（最小構成）

Python 1 プロセス + SQLite 1 ファイルで動作します（root 不要・上位ポートで待受）。Python 3.11+ が前提です。

```bash
cd backend
python -m venv ../.venv && source ../.venv/bin/activate   # 任意: 仮想環境
pip install -r requirements.txt
python manage.py migrate          # 未設定時は db.sqlite3（SQLite 単一ファイル）
DEBUG=true python manage.py runserver 8000
```

### 環境変数

`backend/.env.example` が設定項目のサンプルです。現状は `.env` の自動読込は行わないため、必要な変数は実行環境で `export` するか、コマンド前に付与してください（上記の `DEBUG=true` のように）。主な変数:

| 変数 | 既定 | 説明 |
|------|------|------|
| `SECRET_KEY` | ランダム生成 | Django 秘密鍵。本番では固定値を必ず設定 |
| `DEBUG` | `false` | デバッグモード。開発時のみ `true` |
| `ALLOWED_HOSTS` | 空（DEBUG 時は localhost） | 許可ホスト（カンマ区切り） |
| `DATABASE_URL` | SQLite（`backend/db.sqlite3`） | DB 接続 URL。PostgreSQL 利用時は別途 `psycopg` の導入が必要 |
| `JANUS_REQUIRE_AUTH` | `true` | 全 API を認証必須にする意図フラグ（権限反映は認証実装タスクで） |
| `JANUS_MEDIA_ROOT` | `backend/media/` | アセット保存先 |
| `JANUS_CORS_ALLOWED_ORIGINS` | 空（許可なし） | CORS 許可オリジン（カンマ区切り） |

## ライセンス

未定。
