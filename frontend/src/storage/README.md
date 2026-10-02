# storage/

StorageClient 契約（TypeScript interface）と RestClient 実装を置くディレクトリ。

- `types.ts`: StorageClient / AuthClient / PageClient / AssetClient / SearchClient の型定義と `ApiError`（design 4 / 9 章）。型は backend JSON に忠実な snake_case（変換層なし）。
- `rest-client.ts`: fetch ベースの RestClient 実装（design 5 章）。トークン保持は RestClient 内に閉じ込め、既定はメモリ、`persistToken` で localStorage を併用。
- `rest-client.test.ts`: fetch をモックした契約充足ユニットテスト（実バックエンドには接続しない）。

テストは単発実行（ウォッチ禁止）: `npm run test:run`。

SearchClient はフェーズ 1 では契約のみ。`search()` の実装はフェーズ 4。
