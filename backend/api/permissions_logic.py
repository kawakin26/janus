"""
ページ権限判定の DB 非依存コア（design.md 3 章・タスク 1-2）。

PagePermission モデルや HTTP リクエストに依存しない純粋関数として、権限エントリ
（PermEntry）の合成規則を実装する。候補エントリの DB 取得は呼び出し側（5.1
require_page_permission）が一括で行い、この層は「渡された候補 + デフォルト
ポリシー」だけで view/edit の可否を決める（非機能 6・性能／テスタビリティ）。

合成の優先順位は design.md 3.2「合成の優先順位」のとおり固定で、真理値表
3.3 / 3.3.1 を tests_permissions.py で保護する（セキュリティ境界の中核）。
"""

from dataclasses import dataclass

from .utils import ancestor_paths


@dataclass(frozen=True)
class PermEntry:
    """判定用の軽量な権限エントリ（design.md 3.1）。

    モデル PagePermission の user_id/group_id 2 本の FK を、判定経路では単一
    principal_id に写して扱う（MEDIUM-3 の変換規則は呼び出し側で適用）:
      principal_id = row.user_id if principal_type == "user" else row.group_id

    - path: 正規化済みの対象パス（normalize_path 済み）。
    - principal_type: "user" | "group"。
    - principal_id: 当該 principal_type に対応する user.id または group.id。
    - action: "view" | "edit"。
    - effect: "allow" | "deny"。
    """

    path: str
    principal_type: str
    principal_id: int
    action: str
    effect: str


def resolve_subject_level(subject_entries, action) -> bool | None:
    """ある主体の・あるレベルでの決着を 3 値で返す（design.md 3.2）。

    subject_entries はその主体（user 直接 or 1 group）のそのレベルの全エントリ
    （action 問わず）。戻り値:
      - True / False: 当該レベル・当該主体で確定（より遠い祖先は見ない）。
      - None: このレベル・この主体では決着せず、次の（遠い）祖先に委ねる。

    規則:
      1. 当該 action の明示エントリがあれば deny 優先で決着（deny が 1 つでも
         あれば False、無ければ True）。複数グループ由来の allow/deny 混在時も
         any(deny) で安全側に倒す（P2-4-2）。
      2. action=="view" で view 明示が無く、edit allow があれば含意で True
         （edit→view 含意・P2-1-4）。edit deny は view を拒否しない。
      3. いずれにも該当しなければ None（次の祖先へ）。
    """
    explicit = [e for e in subject_entries if e.action == action]
    if explicit:
        # 当該 action の明示エントリで決着（deny 優先）。
        return not any(e.effect == "deny" for e in explicit)
    if action == "view":
        # view 明示なし → edit allow があれば含意で allow（edit deny は不干渉）。
        if any(e.action == "edit" and e.effect == "allow" for e in subject_entries):
            return True
    return None  # この主体・このレベルでは決着せず → 次の祖先へ。


def effective_permission(
    *,
    path: str,
    action: str,
    user,
    entries: list[PermEntry],
    default_allow: bool,
    default_edit_allow: bool,
) -> bool:
    """path・action に対する実効権限を合成して返す（design.md 3.2 擬似コード）。

    引数:
      - path: 正規化済みの対象パス。
      - action: "view" | "edit"。
      - user: auth.User インスタンス（is_superuser と groups を参照）。
      - entries: 事前取得した候補 PermEntry 群（対象 path と全祖先分）。
      - default_allow: action に対応するデフォルトポリシー（P2-3）。
      - default_edit_allow: edit のデフォルトポリシー（view 問い合わせでも常に
        渡す。デフォルト経由の edit→view 含意に用いる・MEDIUM-1 / 3.3.1）。

    合成順（固定）:
      1. 管理者バイパス: user.is_superuser なら即 True。
      2. 階層的近さ: ancestor_paths(path) を近い順に走査し、各レベルで
         user 直接エントリ → group エントリの順に resolve_subject_level。
         決着（None 以外）すれば即返し、より遠い祖先は見ない。
      3. 全レベル未決着ならデフォルトに委ねる。view 問い合わせで view デフォルト
         不許可・edit デフォルト許可なら含意で True、それ以外は default_allow。
    """
    # 1. 管理者バイパス（P2-1-5 / P2-3-5）。
    if user.is_superuser:
        return True

    ancestors = ancestor_paths(path)  # 近い順: [self, ..., "/"]
    group_ids = {group.id for group in user.groups.all()}

    # 2. 近い祖先から順に評価。
    for level in ancestors:
        level_entries = [e for e in entries if e.path == level]
        user_entries = [
            e
            for e in level_entries
            if e.principal_type == "user" and e.principal_id == user.id
        ]
        group_entries = [
            e
            for e in level_entries
            if e.principal_type == "group" and e.principal_id in group_ids
        ]

        # 同一レベル内の具体性: user 直接 > group（P2-4-4）。
        decided = resolve_subject_level(user_entries, action)
        if decided is not None:
            return decided
        decided = resolve_subject_level(group_entries, action)
        if decided is not None:
            return decided
        # このレベルに該当主体のエントリが無ければ次の（遠い）祖先へ。

    # 3. 全レベルで決着せず → デフォルトに委ねる（含意規則も適用・MEDIUM-1）。
    if action == "view" and not default_allow and default_edit_allow:
        return True
    return default_allow
