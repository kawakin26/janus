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

> **設計変更注記:** タスク6・8・11で実装したページ添付（Attachment）方式は、後から確定した要件14の独立アセットライブラリ方式により置き換える。過去データの移行は行わない。

- [x] 14. 独立アセットライブラリへの移行（要件14・フェーズ1追加実装）
  - [x] 14.1 Folder / Asset モデルとマイグレーション
    - 既存 `Attachment`（Page FK）を削除し、`Folder(parent, name, created_at, updated_at)` と `Asset(folder, filename, alias, file, content_type, created_at, updated_at)` に置き換える。過去 Attachment データの移行は行わない。
    - Folder は親フォルダ配下で `name` 一意、Asset は同一フォルダ内で `filename` 一意・空でない `alias` 一意。ルート（parent/folder が null）の一意性も DB 制約で担保する。
    - 物理ファイルは論理階層を表現しない不透明な UUID/ハッシュ系の保存名でフラット保存し、フォルダ/アセット移動時に物理ファイルを移動しない。論理階層は DB を唯一の正とする。
    - admin、マイグレーション、モデルテストを更新する。既存 Attachment テスト・API テストは新モデルに置き換える。
    - _要件: 14-1, 14-2, 14-3, 14-4, 14-5, 14-6_
  - [x] 14.2 独立アセット REST API
    - `GET/POST /api/folders`（`parent`/`parentId` で直下一覧・作成）、`GET/POST /api/assets?folder=`（直下一覧・multipart登録）、`PATCH /api/assets/<id>`（folderId 変更による移動）、`GET /api/assets/<id>/file`（実体配信）を実装する。
    - アセット登録時は画像/SVG等を直接登録し、`filename` はアップロード元ファイル名、`alias` は任意の登録名として保存する。CAD変換本体はフェーズ3で実装するが、変換後SVGを登録できるAPI形状にする。
    - 同一フォルダ内の filename/alias 重複、同名フォルダ、移動先での重複は 409。ファイルフィールドは basename/制御文字等を安全化し、実体は不透明名で保存する。
    - 旧 `/api/pages/assets?path=` と旧 `/api/assets/<id>` 配信は廃止し、ページ削除でアセットが削除されないことを確認する。
    - APIテストでフォルダ木、ルート/子フォルダ、登録、一覧、配信、重複拒否、移動拒否、ページ独立性を検証する。
    - _要件: 3-3, 14-1〜14-7_
  - [x] 14.3 StorageClient / RestClient 契約の刷新
    - `Folder`、新 `Asset`、`AssetRef` 型を追加し、`AssetClient` を `listFolders`、`createFolder`、`listAssets`、`uploadAsset`、`moveAsset`、`resolveAssetUrl(ref)` 契約へ変更する。旧 pagePath/originalName/candidatePagePaths 方式を削除する。
    - RestClient の URL・multipart・認証・409/404/401処理を新APIへ合わせる。解決はクライアント側で、基準フォルダのパスを Folder ID に解決し、指定子を出現順に filename/alias で検索する。
    - フォルダ内同名を許すため、基準フォルダなしの裸名参照はルート直下を対象とする。参照値に `/` が含まれる場合は基準フォルダからの相対/絶対フォルダ指定として解決する。
    - fetchモックテストで契約、優先順位（先に出現した指定子、失敗時に次）、フォルダ解決、重複エラーを検証する。
    - _要件: 1-1, 1-2, 1-3, 14-7, 14-9〜14-12_
  - [x] 14.4 地図記法とビューアの独立アセット対応
    - custom-map のコンテナ属性に基準フォルダを表す `folder`（または設計書と整合する同等名）を追加し、画像/写真参照を `filename:`/`file:` と `aliasname:`/`alias:` の指定子として解析する。指定子は Markdown/ディレクティブ上の出現順を保持する。
    - `file`/`src`/`photo`/`photoSrc` の旧ページ添付解決を廃止し、map viewer は `AssetRef` を `StorageClient.resolveAssetUrl` に渡す。未解決時は既存の日本語エラー表示を維持する。
    - マーカー、パン/ズーム、回転、最小化、ポップアップ、`link` 等の既存表示機能は壊さず、CAD変換・GUI編集・写真撮影は実装しない。
    - パーサ、指定子の優先/フォールバック、基準フォルダ、アセットURL解決、基本描画のテストを更新する。
    - _要件: 3-1, 3-2, 3-3, 3-5, 14-9〜14-12_
  - [x] 14.5 最小アセット操作 UI と結合確認
    - フェーズ1で登録した画像/SVGを画面から試せるよう、フォルダ直下一覧・フォルダ作成・ファイル選択アップロード（alias入力を含む）・アセットURL確認の最小UIを追加する。フォルダ移動UIの作り込みはフェーズ3へ送るが、APIは先に実装する。
    - ページ画面からアセットを登録するのではなく、独立したアセットライブラリ画面/導線として実装する。ページ削除後もアセットが残ることをUI/APIで確認する。
    - backend/frontend の全回帰テスト、独立アセットの統合テスト、TypeScript、build、lintを通す。物理フラット・DB論理階層・エクスポートはDBから再構築する方針をドキュメント/テスト証跡に残す。
    - _要件: 14-1〜14-8_
```
