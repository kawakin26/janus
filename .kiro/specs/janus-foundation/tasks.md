# Janus 実装計画（フェーズ 1）

本タスクリストは `design.md` のフェーズ 1（サーバーモード基盤）を実装順に分解したもの。各タスクは前のタスクの成果に積み上がる。チェックを付けながら進める。

- [x] 1. リポジトリとモノレポ土台のセットアップ
  - `/home/kawakin/git/knowledge-base/janus` を git リポジトリとして初期化し、`backend/` と `frontend/` を同居させる
  - ルートに `README.md`（プロジェクト概要・2 モードの説明）、`.gitignore`（Python/Node/メディア/DB ファイル）を作成
  - _要件: 13-3_

- [x] 2. Django バックエンドの初期化
  - [x] 2.1 Django + DRF プロジェクトの作成
    - `backend/` に Django プロジェクト `janus` と app `api` を作成。`requirements.txt`（django, djangorestframework, django-cors-headers, dj-database-url 等）を定義
    - `python manage.py runserver 8000` で起動することを確認（root 不要・上位ポート）
    - _要件: 12-1, 12-5_
  - [x] 2.2 設定の環境変数化（DB・公開範囲・メディア）
    - `DATABASE_URL` で SQLite（既定）/ PostgreSQL を切替。`JANUS_REQUIRE_AUTH`（既定 true）、`JANUS_MEDIA_ROOT`、CORS 許可オリジンを環境変数化
    - _要件: 12-2, 12-4, 13-1_

- [x] 3. データモデルとマイグレーション
  - `api/models.py` に `Page`（path 一意・index、title、body、created/updated、created_by/updated_by）と `Attachment`（page FK、original_name index、file、content_type、created_at）を定義
  - マイグレーション作成・適用。管理サイト登録（開発確認用）
  - _要件: 2-1, 2-5, 2-7, 4-5_

- [x] 4. 認証（トークン・契約準拠）
  - [x] 4.1 ログイン/ログアウト/me エンドポイント
    - DRF TokenAuthentication を有効化。`POST /api/auth/login`（token 返却）、`POST /api/auth/logout`（token 無効化）、`GET /api/auth/me`（未認証は null）を実装
    - パスワードは Django のハッシュ機構に委ねる
    - _要件: 4-1, 4-2, 4-3, 4-6_
  - [x] 4.2 既定認証必須・管理者/一般の区別
    - `JANUS_REQUIRE_AUTH=true` のとき全 API を認証必須にする DRF 既定権限を設定。`is_staff`/`is_superuser` で管理者を区別し `me` に反映
    - APITestCase で「未認証は 401」「ログイン後に通る」を検証
    - _要件: 4-2, 4-4_

- [x] 5. ページ CRUD と階層ナビの API
  - [x] 5.1 ページの取得・作成・更新・削除
    - `GET /api/pages?path=`、`POST /api/pages`（重複パスは 409）、`PUT /api/pages?path=`、`DELETE /api/pages?path=` を実装。保存時に `updated_by` を記録
    - path は末尾スラッシュ正規化して一意性を担保
    - _要件: 2-1, 2-2, 2-4, 2-7, 4-5_
  - [x] 5.2 子ページ一覧（階層ナビ）
    - `GET /api/pages/children?parent=` を実装。親直下のみに絞り込む（既存 listChildPages のフィルタ思想）
    - APITestCase で CRUD と重複拒否・子一覧を検証
    - _要件: 2-6_

- [x] 6. アセット（添付）の API と解決
  - `GET /api/pages/assets?path=`（一覧）、`POST /api/pages/assets?path=`（multipart アップロード）、`GET /api/assets/<id>`（実体配信）を実装
  - original_name 照合によるアセット URL 解決（候補ページ順のフォールバック）をサーバー側 or クライアント側のどちらで行うか確定し実装（design 7 章の方針）
  - APITestCase でアップロード→一覧→解決を検証
  - _要件: 3-3, 3-5_

- [x] 7. フロントエンド土台（Vite + React + TS）
  - `frontend/` に Vite + React + TypeScript を初期化。React Router を導入し、`/`（一覧）・`/view/*`（閲覧）・`/edit/*`（編集）・`/login` のルートを用意
  - _要件: 2-6_

- [x] 8. StorageClient 契約と RestClient 実装
  - [x] 8.1 契約（インターフェース）定義
    - `frontend/src/storage/types.ts` に `AuthClient`/`PageClient`/`AssetClient`/`SearchClient`/`StorageClient` と関連型を定義。`SearchClient` は契約のみ（実装はフェーズ 4）
    - _要件: 1-1, 1-4, 11-4_
  - [x] 8.2 RestClient 実装
    - `frontend/src/storage/rest-client.ts` に fetch ベースで契約を実装。トークンの保持・付与、API エラーを例外へ変換、401 の扱いを実装
    - fetch をモックしたユニットテストで契約充足を検証
    - _要件: 1-2, 9（DRF 連携）_

- [x] 9. 認証 UI とルートガード
  - ログイン画面（username/password → login）、ログアウト、`currentUser` によるルートガード（未認証は `/login` へ）を実装
  - _要件: 4-1, 4-2_

- [x] 10. ページ閲覧・編集 UI（Markdown）
  - [x] 10.1 Markdown レンダラ
    - remark/rehype + remark-directive でフロント描画。閲覧画面で本文をレンダリング
    - _要件: 2-3_
  - [x] 10.2 作成・編集・削除 UI
    - 新規作成（パス入力・重複は 409 を通知）、編集保存、削除を StorageClient 経由で実装。一覧/階層ナビから遷移
    - _要件: 2-1, 2-2, 2-4, 2-6, 2-7_

- [x] 11. 地図ビューアの移植（画像のみ・表示）
  - [x] 11.1 記法パースとモーダル描画の移植
    - 既存 `src/viewer.ts`/`src/common.ts` から GROWI 非依存部分（記法パース、モーダル、パン/ズーム/90 度回転、最小化/復帰、写真/説明ポップアップ、`textColorForBg` 等）を `frontend/src/markdown/custom-map/` へ移植。記法仕様（コンテナ/マーカー属性）は不変
    - _要件: 3-1, 3-2_
  - [x] 11.2 GROWI 依存の置換
    - 添付解決・現在ページ解決・設定取得の GROWI API 依存を `StorageClient`（`getPage`/`listAssets`/`resolveAssetUrl`）と React Router の現在ルートに置換。CAD 連携は含めない（フェーズ 3）
    - 記法パースのユニットテストを移植。画像アセット上にマーカーが表示されることを手動確認
    - _要件: 3-1, 3-3, 3-5_

- [x] 12. フェーズ 1 の結合確認とドキュメント
  - ログイン → ページ作成 → 閲覧（Markdown + 地図記法で画像マーカー表示）→ 編集 → 削除、の一連を手動シナリオで確認
  - `README.md` に起動手順（最小構成: runserver + SQLite、フロントの dev/build）、環境変数、2 モード構想（ローカルはフェーズ 3）を記載
  - _要件: 2, 3（表示）, 4, 12, 13_

- [x] 13. UI 仕上げ（ナビゲーションと最小スタイリング）
  - 手動テストで判明したフェーズ 1 の実用性課題への対応。機能は実装済みだが、画面間の移動導線が不足し、無装飾で使い勝手が低い点を補う。
  - 共通ヘッダーを強化（アプリ名「Janus」をトップ `/` へのリンク化、「ページ一覧」導線の常設、ユーザー名・ログアウトの整理）。どの画面からもトップへ戻れるようにする
  - 閲覧画面（PageViewPage）・編集画面にパンくず（`/docs/intro` を `docs > intro` と親を辿れる）を追加し、親ページ・一覧へ移動できるようにする
  - 一覧・階層ナビ（PageListPage）の見やすさと新規作成導線を改善
  - 最小限のスタイリングを素の CSS で適用（余白・配色・フォント・ボタン・入力欄・一覧。重い UI フレームワークは入れない＝軽量方針を維持）
  - _要件: 2-6（階層ナビ）, 2（使い勝手）, 13（軽量性）_
```
