/**
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 */
// null'ing of global vars need to be after init.js
window.ICONSEARCH_PATH = null; // cdn3.iconfinder.com 系アイコン検索を無効化
window.ICON_SERVICE_PATH = null; // 外部アイコンサービスを無効化

// --- Janus offline hardening (FEAT-001 / Block4 draw.io) ---
// 外部 Web フォント（fonts.googleapis.com）への実行時接続を抑止する。
// init.js で定義される Editor の Google Fonts 由来 URL を空にして動的ロードを行わせない。
if (typeof Editor !== 'undefined') {
	Editor.GOOGLE_FONTS = ''; // Google Fonts CSS 取得 URL を無効化
	Editor.GOOGLE_FONTS_CSS2 = ''; // Google Fonts CSS2 取得 URL を無効化
	Editor.sketchFontSource = ''; // スケッチ用外部フォント取得 URL を無効化
}
