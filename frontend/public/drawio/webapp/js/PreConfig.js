/**
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 */
// Overrides of global vars need to be pre-loaded
window.DRAWIO_PUBLIC_BUILD = true;
window.EXPORT_URL = null; // Replace with the URL of your export server to enable server-side PDF and image export, e.g. https://www.example.com/export. With null, export to PDF uses the print dialog
window.DRAWIO_BASE_URL = null; // Replace with path to base of deployment, e.g. https://www.example.com/folder
window.DRAWIO_VIEWER_URL = null; // Replace your path to the viewer js, e.g. https://www.example.com/js/viewer.min.js
window.DRAWIO_LIGHTBOX_URL = null; // Replace with your lightbox URL, eg. https://www.example.com
window.DRAW_MATH_URL = 'math4/es5';
window.DRAWIO_CONFIG = null; // Replace with your custom draw.io configurations. For more details, https://www.drawio.com/doc/faq/configure-diagram-editor
urlParams['sync'] = 'manual';

// --- Janus offline hardening (FEAT-001 / Block4 draw.io) ---
// セルフホスト同梱のみで動かし、公開 CDN / 外部サービスへの実行時接続を抑止する。
// 静的文字列（embed.diagrams.net 等）は app.min.js 内に残存するが（スパイク §3 既知）、
// 以下で実リクエストが発火しないよう urlParams とグローバル URL/PATH を自オリジン固定/無効化する。

// オフライン動作・外部機能の無効化。
urlParams['offline'] = '1'; // オフラインモード（外部ストレージ/同期を使わない）
urlParams['stealth'] = '1'; // 外部 fetch を伴う機能（アイコン検索 / オンラインテンプレ等）を抑止
urlParams['plugins'] = '0'; // 外部プラグイン読み込み無効
urlParams['analytics'] = '0'; // 解析系（外部送信）無効
urlParams['gapi'] = '0'; // Google API 無効
urlParams['db'] = '0'; // Dropbox 無効
urlParams['od'] = '0'; // OneDrive 無効
urlParams['gh'] = '0'; // GitHub 無効
urlParams['gl'] = '0'; // GitLab 無効
urlParams['tr'] = '0'; // Trello 無効

// 外部サービス URL を null 化（公開 embed/サーバ/ログ/通知等への接続抑止）。
window.DRAWIO_SERVER_URL = null; // app.diagrams.net 系サーバ参照
window.NOTIFICATIONS_URL = null; // 通知フィード（外部）
window.DRAWIO_LOG_URL = null; // 外部ログ送信
window.PLANT_URL = null; // PlantUML 外部レンダラ
window.VSS_CONVERT_URL = null; // VSSX 変換（外部）
window.OPEN_URL = null; // 外部 open サービス
window.SAVE_URL = null; // 外部 save サービス
window.PROXY_URL = null; // 画像/URL 取得プロキシ（外部）
window.PUSHER_URL = null; // リアルタイム（外部）
window.RT_WEBSOCKET_URL = null; // リアルタイム WebSocket（外部）
window.REALTIME_URL = null; // リアルタイム（外部）

// リソース/ステンシル/テンプレ等の基準を自オリジン（同梱 webapp 配下）に固定する。
window.RESOURCES_PATH = 'resources';
window.STENCIL_PATH = 'stencils';
window.SHAPES_PATH = 'shapes';
window.STYLE_PATH = 'styles';
window.IMAGE_PATH = 'images';
window.GRAPH_IMAGE_PATH = 'img';
window.TEMPLATE_PATH = 'templates';
window.CSS_PATH = 'styles';
window.NEW_DIAGRAM_CATS_PATH = 'templates';
window.PLUGINS_BASE_PATH = '';
