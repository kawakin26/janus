"""
ページ認可ゲート（design.md 5.1「認可の配置方針」）。

view/edit の認可判定は独自 DRF Permission クラスを作らず、各ビューのメソッド
冒頭で `require_page_permission(request, path, action)` を 1 回だけ呼ぶ方式に
一本化する（MEDIUM-B の確定）。401（未認証）は既存 DEFAULT_PERMISSION_CLASSES
（IsAuthenticated）が担保し、本ヘルパは view/edit の 403/404 切替のみを担う。

本モジュールは候補 PagePermission を 3.5 の方式で一括取得し、純粋判定関数
effective_permission（permissions_logic）へ橋渡しする。設定フラグは
django.conf.settings 経由で参照し、override_settings を効かせる（モジュール
トップでの定数束縛はしない）。
"""

from django.conf import settings
from django.db.models import Q
from rest_framework import status
from rest_framework.response import Response

from .models import PagePermission
from .permissions_logic import PermEntry, effective_permission
from .utils import ancestor_paths

# 固定 detail 定数（本文・メタを含めない。design 4 章・P2-7-4）。
PERMISSION_DENIED_DETAIL = "この操作を行う権限がありません。"
PERMISSION_ENTRY_NOT_FOUND_DETAIL = "指定された権限エントリが見つかりません。"


def _denied_response(hide_forbidden: bool) -> Response:
    """拒否時の応答を返す。既定 403／秘匿運用（True）のとき 404（design 4 章）。"""
    if hide_forbidden:
        # 存在秘匿: 404。本文・メタは含めず固定 detail のみ。
        from .views import PAGE_NOT_FOUND_DETAIL

        return Response(
            {"detail": PAGE_NOT_FOUND_DETAIL}, status=status.HTTP_404_NOT_FOUND
        )
    return Response(
        {"detail": PERMISSION_DENIED_DETAIL}, status=status.HTTP_403_FORBIDDEN
    )


def _collect_entries(path: str, user) -> list[PermEntry]:
    """対象 path とその全祖先に設定された、当該ユーザー向け候補を一括取得する。

    design 3.5 の一括取得方式。認証済みユーザー前提（匿名は呼び出し側で分岐）。
    各 PagePermission（2 FK）を PermEntry（単一 principal_id）へ写す際、
    principal_id = row.user_id if principal_type=='user' else row.group_id
    の変換規則を適用する（design 3.5 MEDIUM-3）。
    """
    ancestors = ancestor_paths(path)
    group_ids = set(user.groups.values_list("id", flat=True))
    rows = PagePermission.objects.filter(path__in=ancestors).filter(
        Q(principal_type="user", user=user)
        | Q(principal_type="group", group_id__in=group_ids)
    )
    entries = []
    for row in rows:
        principal_id = row.user_id if row.principal_type == "user" else row.group_id
        entries.append(
            PermEntry(
                path=row.path,
                principal_type=row.principal_type,
                principal_id=principal_id,
                action=row.action,
                effect=row.effect,
            )
        )
    return entries


def check_permission(request, path: str, action: str) -> bool:
    """path・action に対する現在ユーザーの実効可否を bool で返す（応答生成なし）。

    匿名ユーザー（未認証）は effective_permission を呼ばず、デフォルトポリシー
    のみで判定する（design 5.1 匿名ユーザーの扱い・MEDIUM-1）。認証済みは
    候補エントリを一括取得して純粋判定関数に委ねる。view 判定では
    default_edit_allow を常に渡し、デフォルト経由の edit→view 含意を効かせる。
    """
    default_allow = (
        settings.JANUS_DEFAULT_PAGE_VIEW
        if action == "view"
        else settings.JANUS_DEFAULT_PAGE_EDIT
    )
    default_edit_allow = settings.JANUS_DEFAULT_PAGE_EDIT

    if not request.user.is_authenticated:
        # 匿名は権限エントリの主体になれない → デフォルトのみで判定（含意も適用）。
        if action == "view" and not default_allow and default_edit_allow:
            return True
        return default_allow

    entries = _collect_entries(path, request.user)
    return effective_permission(
        path=path,
        action=action,
        user=request.user,
        entries=entries,
        default_allow=default_allow,
        default_edit_allow=default_edit_allow,
    )


def require_page_permission(request, path: str, action: str) -> Response | None:
    """認可ゲート。許可なら None、拒否なら 403（既定）／404（秘匿）を返す。

    design 5.1 の契約。ページ実在は参照しない（path・エントリ・デフォルトのみ）。
    存在確認は呼び出し側ビューが別途行い「権限 → 存在」の順序を守る。
    """
    if check_permission(request, path, action):
        return None
    return _denied_response(settings.JANUS_HIDE_FORBIDDEN)


def require_edit_permission_strict(request, path: str) -> Response | None:
    """POST（新規作成）専用の edit ゲート。拒否は常に 403（秘匿無効）。

    POST はまだ存在しない path を作る操作で、秘匿すべき既存リソースが無いため
    JANUS_HIDE_FORBIDDEN に関わらず常に 403 を返す（design 4 章・5.2・MEDIUM-C）。
    """
    if check_permission(request, path, "edit"):
        return None
    return Response(
        {"detail": PERMISSION_DENIED_DETAIL}, status=status.HTTP_403_FORBIDDEN
    )


def can_modify_comment(request, comment) -> bool:
    """コメント編集/削除の可否を bool で返す（design 3.2・要件 3A-C-11）。

    「投稿者本人 or ページ edit 権限 or 管理者」を 1 ヘルパに閉じ込める。独自の
    階層判定は作らず既存ロジックのみ流用する。(1) superuser は常に True
    （check_permission(edit) 内でも True になるが可読性のため先に見る）。(2) 投稿者
    本人（author が null 化されている場合は本人判定不可 → False 側）。(3) 対象
    ページの edit 権限（階層継承・Deny 優先・含意は check_permission に委譲）。

    注意: ここでは require_page_permission を使わない。したがって拒否は
    JANUS_HIDE_FORBIDDEN に関わらず常に固定 403（design 3.2）。check_permission は
    応答生成をせず bool を返すだけで、404 すり替えを経由しない。
    """
    if request.user.is_superuser:
        return True
    if comment.author_id is not None and comment.author_id == request.user.id:
        return True
    return check_permission(request, comment.page.path, "edit")


def compute_view_edit(request, path: str) -> dict:
    """現在ユーザーの path に対する {'view': bool, 'edit': bool} を返す（design 5.4）。

    秘匿運用でも 403/404 を返さず、権限が無ければ {False, False} を返すだけで
    存在を漏らさない。view 判定には default_edit_allow 含意が適用される
    （check_permission 経由）。
    """
    return {
        "view": check_permission(request, path, "view"),
        "edit": check_permission(request, path, "edit"),
    }
