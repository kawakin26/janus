"""
権限判定コア（permissions_logic / utils.ancestor_paths）のユニットテスト。

design.md 3.2 合成規則・3.3 真理値表（#1〜#10）・3.3.1 デフォルトポリシー経由の
edit→view 含意（D1〜D4）・3.4 祖先パス導出をそのまま移植して固定する。純粋関数
ゆえ SimpleTestCase（DB 非依存）で検証する（normalize_path のテスト流儀）。

真理値表の基準シナリオ: 対象 "/docs/intro"、ユーザー alice（group editors 所属）。
user は Django auth.User のモック（is_superuser / id / groups.all() を持つ簡易
オブジェクト）で表し、DB を一切触らない。
"""

from django.test import SimpleTestCase

from .permissions_logic import PermEntry, effective_permission, resolve_subject_level
from .utils import ancestor_paths


class _FakeGroup:
    """auth.Group の最小モック（id のみ）。"""

    def __init__(self, group_id):
        self.id = group_id


class _FakeGroups:
    """user.groups マネージャの最小モック（all() のみ）。"""

    def __init__(self, group_ids):
        self._groups = [_FakeGroup(gid) for gid in group_ids]

    def all(self):
        return list(self._groups)


class _FakeUser:
    """auth.User の最小モック。DB を触らず is_superuser/id/groups を提供する。"""

    def __init__(self, *, user_id, group_ids=(), is_superuser=False):
        self.id = user_id
        self.is_superuser = is_superuser
        self.groups = _FakeGroups(group_ids)


# 基準シナリオの固定値。
ALICE_ID = 1
EDITORS_ID = 10
READERS_ID = 11
TARGET = "/docs/intro"
PARENT = "/docs"


def _alice(**kwargs):
    return _FakeUser(user_id=ALICE_ID, group_ids=(EDITORS_ID,), **kwargs)


def _user_entry(path, action, effect, principal_id=ALICE_ID):
    return PermEntry(
        path=path,
        principal_type="user",
        principal_id=principal_id,
        action=action,
        effect=effect,
    )


def _group_entry(path, action, effect, principal_id=EDITORS_ID):
    return PermEntry(
        path=path,
        principal_type="group",
        principal_id=principal_id,
        action=action,
        effect=effect,
    )


def _view(user, entries, *, default_allow, default_edit_allow=None):
    # view 問い合わせ。default_edit_allow 未指定なら default_allow と同値。
    if default_edit_allow is None:
        default_edit_allow = default_allow
    return effective_permission(
        path=TARGET,
        action="view",
        user=user,
        entries=entries,
        default_allow=default_allow,
        default_edit_allow=default_edit_allow,
    )


class AncestorPathsTests(SimpleTestCase):
    """ancestor_paths のユニットテスト（design.md 3.4・NIT-1 境界）。"""

    def test_nested_path_returns_self_then_ancestors_near_first(self):
        # 自身を含み近い順。例の固定（受け入れ基準）。
        self.assertEqual(
            ancestor_paths("/docs/intro"), ["/docs/intro", "/docs", "/"]
        )

    def test_single_segment_path(self):
        # トップレベル 1 段 → 自身とルート。
        self.assertEqual(ancestor_paths("/docs"), ["/docs", "/"])

    def test_root_returns_only_itself(self):
        # ルート境界: ルートは自身のみを祖先に持つ（NIT-1）。
        self.assertEqual(ancestor_paths("/"), ["/"])


class ResolveSubjectLevelTests(SimpleTestCase):
    """resolve_subject_level の 3 値決着規則（design.md 3.2）。"""

    def test_no_entries_returns_none(self):
        self.assertIsNone(resolve_subject_level([], "view"))

    def test_explicit_allow_decides_true(self):
        entries = [_user_entry(TARGET, "view", "allow")]
        self.assertTrue(resolve_subject_level(entries, "view"))

    def test_explicit_deny_wins_over_allow_same_action(self):
        # 当該 action の明示に deny が混ざれば deny 優先（安全側・P2-4-2）。
        entries = [
            _user_entry(TARGET, "view", "allow"),
            _user_entry(TARGET, "view", "deny"),
        ]
        self.assertFalse(resolve_subject_level(entries, "view"))

    def test_view_implied_by_edit_allow(self):
        # view 明示なし + edit allow → 含意で True。
        entries = [_user_entry(TARGET, "edit", "allow")]
        self.assertTrue(resolve_subject_level(entries, "view"))

    def test_edit_deny_does_not_block_view(self):
        # edit deny のみは view を拒否しない → None（次の祖先へ）。
        entries = [_user_entry(TARGET, "edit", "deny")]
        self.assertIsNone(resolve_subject_level(entries, "view"))


class EffectivePermissionTruthTableTests(SimpleTestCase):
    """design.md 3.3 真理値表 #1〜#10 を default_allow 真偽両方で固定する。"""

    def test_case1_no_entries_defaults(self):
        # #1 エントリなし → デフォルトに委ねる。
        self.assertTrue(_view(_alice(), [], default_allow=True))
        self.assertFalse(_view(_alice(), [], default_allow=False))

    def test_case2_ancestor_deny_inherited(self):
        # #2 親 /docs の view deny が継承される。
        entries = [_user_entry(PARENT, "view", "deny")]
        self.assertFalse(_view(_alice(), entries, default_allow=True))
        self.assertFalse(_view(_alice(), entries, default_allow=False))

    def test_case3_nearer_level_wins(self):
        # #3 近いレベル（自身 allow）が親 deny に勝つ（P2-2-3）。
        entries = [
            _user_entry(TARGET, "view", "allow"),
            _user_entry(PARENT, "view", "deny"),
        ]
        self.assertTrue(_view(_alice(), entries, default_allow=True))
        self.assertTrue(_view(_alice(), entries, default_allow=False))

    def test_case4_parent_deny_inherited(self):
        # #4 自身にエントリ無し → 親 deny を継承。
        entries = [_user_entry(PARENT, "view", "deny")]
        self.assertFalse(_view(_alice(), entries, default_allow=True))
        self.assertFalse(_view(_alice(), entries, default_allow=False))

    def test_case5_child_allow_over_parent_deny(self):
        # #5 子の明示 allow が親 deny に優先（P2-6-3）。
        entries = [
            _user_entry(TARGET, "view", "allow"),
            _user_entry(PARENT, "view", "deny"),
        ]
        self.assertTrue(_view(_alice(), entries, default_allow=True))
        self.assertTrue(_view(_alice(), entries, default_allow=False))

    def test_case6_user_direct_over_group_same_level(self):
        # #6 同レベルで user 直接 > group。user deny が勝つ（P2-4-4）。
        entries = [
            _group_entry(TARGET, "view", "allow"),
            _user_entry(TARGET, "view", "deny"),
        ]
        self.assertFalse(_view(_alice(), entries, default_allow=True))
        self.assertFalse(_view(_alice(), entries, default_allow=False))

    def test_case7_deny_wins_same_specificity(self):
        # #7 同レベル同具体性（両グループ所属）で deny 優先（P2-4-2）。
        user = _FakeUser(user_id=ALICE_ID, group_ids=(EDITORS_ID, READERS_ID))
        entries = [
            _group_entry(TARGET, "view", "allow", principal_id=EDITORS_ID),
            _group_entry(TARGET, "view", "deny", principal_id=READERS_ID),
        ]
        self.assertFalse(_view(user, entries, default_allow=True))
        self.assertFalse(_view(user, entries, default_allow=False))

    def test_case8_edit_allow_only_implies_view(self):
        # #8 edit allow のみ（view 問い合わせ）→ 含意で allow（HIGH-3-(b)）。
        entries = [_user_entry(TARGET, "edit", "allow")]
        self.assertTrue(_view(_alice(), entries, default_allow=True))
        self.assertTrue(_view(_alice(), entries, default_allow=False))

    def test_case9_view_deny_beats_edit_allow_implication(self):
        # #9 同主体同レベルで view deny が edit allow 含意に優先（HIGH-3-(a)）。
        entries = [
            _user_entry(TARGET, "view", "deny"),
            _user_entry(TARGET, "edit", "allow"),
        ]
        self.assertFalse(_view(_alice(), entries, default_allow=True))
        self.assertFalse(_view(_alice(), entries, default_allow=False))

    def test_case10_edit_deny_only_falls_back_to_default(self):
        # #10 edit deny のみ → view を拒否せずデフォルトに委ねる（HIGH-3-(c)）。
        entries = [_user_entry(TARGET, "edit", "deny")]
        self.assertTrue(_view(_alice(), entries, default_allow=True))
        self.assertFalse(_view(_alice(), entries, default_allow=False))


class DefaultPolicyImplicationTests(SimpleTestCase):
    """design.md 3.3.1 デフォルトポリシー経由の edit→view 含意（D1〜D4）。"""

    def test_d1_view_true_edit_true(self):
        self.assertTrue(
            _view(_alice(), [], default_allow=True, default_edit_allow=True)
        )

    def test_d2_view_true_edit_false(self):
        self.assertTrue(
            _view(_alice(), [], default_allow=True, default_edit_allow=False)
        )

    def test_d3_both_false_denies(self):
        self.assertFalse(
            _view(_alice(), [], default_allow=False, default_edit_allow=False)
        )

    def test_d4_view_false_edit_true_implies_view_allow(self):
        # D4: view デフォルト不許可だが edit デフォルト許可 → view=allow・edit=allow。
        self.assertTrue(
            _view(_alice(), [], default_allow=False, default_edit_allow=True)
        )
        edit = effective_permission(
            path=TARGET,
            action="edit",
            user=_alice(),
            entries=[],
            default_allow=True,
            default_edit_allow=True,
        )
        self.assertTrue(edit)


class SuperuserBypassTests(SimpleTestCase):
    """管理者バイパス（design.md 3.2 ステップ 1・P2-1-5 / P2-3-5）。"""

    def test_superuser_allowed_despite_deny_and_default_false(self):
        # 明示 deny + default_allow=False でも superuser は True。
        superuser = _FakeUser(user_id=ALICE_ID, is_superuser=True)
        entries = [_user_entry(TARGET, "view", "deny")]
        self.assertTrue(_view(superuser, entries, default_allow=False))


# ---------------------------------------------------------------------------
# API 統合テスト（design 5.1〜5.4）。認可ゲート・権限管理 API・実効権限 API を
# DB/HTTP 込みで検証する。既存 tests_pages.py 流儀（reverse / force_authenticate）。
# ---------------------------------------------------------------------------
from django.contrib.auth import get_user_model  # noqa: E402
from django.contrib.auth.models import Group  # noqa: E402
from django.test import override_settings  # noqa: E402
from django.urls import reverse  # noqa: E402
from rest_framework import status  # noqa: E402
from rest_framework.test import APITestCase  # noqa: E402

from .models import Page, PagePermission  # noqa: E402


def _make_user_perm(path, user, action, effect):
    return PagePermission.objects.create(
        path=path,
        principal_type="user",
        user=user,
        action=action,
        effect=effect,
    )


def _make_group_perm(path, group, action, effect):
    return PagePermission.objects.create(
        path=path,
        principal_type="group",
        group=group,
        action=action,
        effect=effect,
    )


class PageAuthzGateTests(APITestCase):
    """ページ系ビューの認可ゲート（design 5.2）。既定フラグでは差分ゼロ。"""

    def setUp(self):
        self.user_model = get_user_model()
        self.alice = self.user_model.objects.create_user(
            username="alice", password="pw-123456"
        )
        self.pages_url = reverse("api:pages")
        self.children_url = reverse("api:pages-children")
        Page.objects.create(path="/docs/intro", title="Intro", created_by=self.alice)

    def _auth(self, user=None):
        self.client.force_authenticate(user=user or self.alice)

    # --- 未認証 vs 認証済み（401 と 403 の区別） ---
    def test_get_unauthenticated_is_401(self):
        res = self.client.get(self.pages_url, {"path": "/docs/intro"})
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    @override_settings(JANUS_DEFAULT_PAGE_VIEW=False, JANUS_DEFAULT_PAGE_EDIT=False)
    def test_get_authenticated_no_view_is_403(self):
        self._auth()
        res = self.client.get(self.pages_url, {"path": "/docs/intro"})
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    @override_settings(
        JANUS_DEFAULT_PAGE_VIEW=False,
        JANUS_DEFAULT_PAGE_EDIT=False,
        JANUS_HIDE_FORBIDDEN=True,
    )
    def test_get_no_view_hidden_is_404(self):
        # 秘匿運用: view 拒否は 404（存在を参照しない）。
        self._auth()
        res = self.client.get(self.pages_url, {"path": "/docs/intro"})
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    @override_settings(JANUS_DEFAULT_PAGE_VIEW=False, JANUS_DEFAULT_PAGE_EDIT=False)
    def test_get_permission_before_existence(self):
        # 非実在 path でも権限が先に立つ（403、存在を漏らさない）。
        self._auth()
        res = self.client.get(self.pages_url, {"path": "/nope"})
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    @override_settings(JANUS_DEFAULT_PAGE_VIEW=False, JANUS_DEFAULT_PAGE_EDIT=False)
    def test_get_explicit_allow_passes_then_existence(self):
        # view allow 通過後、存在する → 200。
        self._auth()
        _make_user_perm("/docs/intro", self.alice, "view", "allow")
        res = self.client.get(self.pages_url, {"path": "/docs/intro"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        # 許可されても非実在なら 404（権限 → 存在順）。
        _make_user_perm("/docs/ghost", self.alice, "view", "allow")
        res2 = self.client.get(self.pages_url, {"path": "/docs/ghost"})
        self.assertEqual(res2.status_code, status.HTTP_404_NOT_FOUND)

    @override_settings(JANUS_DEFAULT_PAGE_EDIT=False, JANUS_DEFAULT_PAGE_VIEW=False)
    def test_put_delete_no_edit_is_403(self):
        self._auth()
        res_put = self.client.put(
            f"{self.pages_url}?path=/docs/intro", {"body": "x"}
        )
        self.assertEqual(res_put.status_code, status.HTTP_403_FORBIDDEN)
        res_del = self.client.delete(f"{self.pages_url}?path=/docs/intro")
        self.assertEqual(res_del.status_code, status.HTTP_403_FORBIDDEN)

    @override_settings(
        JANUS_DEFAULT_PAGE_EDIT=False,
        JANUS_DEFAULT_PAGE_VIEW=False,
        JANUS_HIDE_FORBIDDEN=True,
    )
    def test_put_delete_no_edit_hidden_is_404(self):
        self._auth()
        res_put = self.client.put(
            f"{self.pages_url}?path=/docs/intro", {"body": "x"}
        )
        self.assertEqual(res_put.status_code, status.HTTP_404_NOT_FOUND)
        res_del = self.client.delete(f"{self.pages_url}?path=/docs/intro")
        self.assertEqual(res_del.status_code, status.HTTP_404_NOT_FOUND)

    @override_settings(
        JANUS_DEFAULT_PAGE_EDIT=False,
        JANUS_DEFAULT_PAGE_VIEW=False,
        JANUS_HIDE_FORBIDDEN=True,
    )
    def test_post_no_edit_always_403_even_when_hidden(self):
        # POST の edit 拒否は秘匿設定に関わらず常に 403（MEDIUM-C）。
        self._auth()
        res = self.client.post(
            self.pages_url, {"path": "/docs/new", "body": "x"}
        )
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    @override_settings(JANUS_DEFAULT_PAGE_EDIT=False, JANUS_DEFAULT_PAGE_VIEW=False)
    def test_post_edit_allow_creates(self):
        # 新規 path 自身への先行エントリ（仮想ノード）で作成可。
        self._auth()
        _make_user_perm("/docs/new", self.alice, "edit", "allow")
        res = self.client.post(
            self.pages_url, {"path": "/docs/new", "body": "x"}
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

    @override_settings(JANUS_DEFAULT_PAGE_EDIT=False, JANUS_DEFAULT_PAGE_VIEW=False)
    def test_superuser_passes_all_gates(self):
        root = self.user_model.objects.create_superuser(
            username="root", password="pw-123456"
        )
        self._auth(root)
        res_get = self.client.get(self.pages_url, {"path": "/docs/intro"})
        self.assertEqual(res_get.status_code, status.HTTP_200_OK)
        res_post = self.client.post(
            self.pages_url, {"path": "/docs/super", "body": "x"}
        )
        self.assertEqual(res_post.status_code, status.HTTP_201_CREATED)

    def test_default_flags_preserve_phase1_behavior(self):
        # 既定フラグ（全許可）: 作成 201・取得 200。
        self._auth()
        res_post = self.client.post(
            self.pages_url, {"path": "/docs/plain", "body": "x"}
        )
        self.assertEqual(res_post.status_code, status.HTTP_201_CREATED)
        res_get = self.client.get(self.pages_url, {"path": "/docs/plain"})
        self.assertEqual(res_get.status_code, status.HTTP_200_OK)


class PageChildrenAuthzTests(APITestCase):
    """children は常に 200・view 可の子のみ返す（design 5.2 MEDIUM-3）。"""

    def setUp(self):
        self.user_model = get_user_model()
        self.alice = self.user_model.objects.create_user(
            username="alice", password="pw-123456"
        )
        self.children_url = reverse("api:pages-children")
        for path in ("/docs", "/docs/pub", "/docs/secret"):
            Page.objects.create(path=path, title=path, created_by=self.alice)
        self.client.force_authenticate(user=self.alice)

    @override_settings(JANUS_DEFAULT_PAGE_VIEW=False, JANUS_DEFAULT_PAGE_EDIT=False)
    def test_children_returns_only_viewable(self):
        # /docs/pub のみ明示 allow。/docs/secret は返さない。親可視性は不問。
        _make_user_perm("/docs/pub", self.alice, "view", "allow")
        res = self.client.get(self.children_url, {"parent": "/docs"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        paths = {item["path"] for item in res.data}
        self.assertEqual(paths, {"/docs/pub"})

    @override_settings(JANUS_DEFAULT_PAGE_VIEW=False, JANUS_DEFAULT_PAGE_EDIT=False)
    def test_child_allow_returned_even_when_parent_hidden(self):
        # 親 /docs 非公開でも子の明示 allow は返る（P2-6-3）。
        _make_user_perm("/docs/pub", self.alice, "view", "allow")
        res = self.client.get(self.children_url, {"parent": "/docs"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual([i["path"] for i in res.data], ["/docs/pub"])

    @override_settings(JANUS_DEFAULT_PAGE_VIEW=False, JANUS_DEFAULT_PAGE_EDIT=False)
    def test_nonexistent_parent_and_zero_visible_same_empty(self):
        # 非実在 parent と可視子ゼロの parent はともに 200+[]。
        res_ghost = self.client.get(self.children_url, {"parent": "/ghost"})
        res_hidden = self.client.get(self.children_url, {"parent": "/docs"})
        self.assertEqual(res_ghost.status_code, status.HTTP_200_OK)
        self.assertEqual(res_hidden.status_code, status.HTTP_200_OK)
        self.assertEqual(res_ghost.data, [])
        self.assertEqual(res_hidden.data, [])


class PermissionManagementApiTests(APITestCase):
    """権限管理 API（design 5.3）。edit 権限者/管理者のみ・409・PATCH・DELETE。"""

    def setUp(self):
        self.user_model = get_user_model()
        self.owner = self.user_model.objects.create_user(
            username="owner", password="pw-123456"
        )
        self.other = self.user_model.objects.create_user(
            username="other", password="pw-123456"
        )
        self.target_user = self.user_model.objects.create_user(
            username="target", password="pw-123456"
        )
        self.group = Group.objects.create(name="editors")
        self.list_url = reverse("api:pages-permissions")

    def _detail_url(self, pk):
        return reverse("api:pages-permissions-detail", args=[pk])

    @override_settings(JANUS_DEFAULT_PAGE_EDIT=False, JANUS_DEFAULT_PAGE_VIEW=False)
    def test_non_editor_forbidden(self):
        self.client.force_authenticate(user=self.other)
        res = self.client.get(self.list_url, {"path": "/docs"})
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    @override_settings(JANUS_DEFAULT_PAGE_EDIT=False, JANUS_DEFAULT_PAGE_VIEW=False)
    def test_editor_can_list_create_and_duplicate_409(self):
        _make_user_perm("/docs", self.owner, "edit", "allow")
        self.client.force_authenticate(user=self.owner)
        # 一覧は当該 path の全エントリ（owner 自身の edit allow を含む）/ 200。
        res_list = self.client.get(self.list_url, {"path": "/docs"})
        self.assertEqual(res_list.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res_list.data), 1)
        # 子 path は祖先 /docs の edit を継承し通過、エントリ 0 件 → 200+[]。
        res_empty = self.client.get(self.list_url, {"path": "/docs/sub"})
        self.assertEqual(res_empty.status_code, status.HTTP_200_OK)
        self.assertEqual(res_empty.data, [])
        # 作成 201。
        body = {
            "path": "/docs",
            "principalType": "user",
            "principalId": self.target_user.id,
            "action": "view",
            "effect": "allow",
        }
        res_create = self.client.post(self.list_url, body, format="json")
        self.assertEqual(res_create.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res_create.data["principalType"], "user")
        self.assertEqual(res_create.data["principalId"], self.target_user.id)
        # 重複 (path,主体,action) は 409。
        res_dup = self.client.post(self.list_url, body, format="json")
        self.assertEqual(res_dup.status_code, status.HTTP_409_CONFLICT)

    @override_settings(JANUS_DEFAULT_PAGE_EDIT=False, JANUS_DEFAULT_PAGE_VIEW=False)
    def test_admin_can_manage(self):
        root = self.user_model.objects.create_superuser(
            username="root", password="pw-123456"
        )
        self.client.force_authenticate(user=root)
        body = {
            "path": "/docs",
            "principalType": "group",
            "principalId": self.group.id,
            "action": "edit",
            "effect": "allow",
        }
        res = self.client.post(self.list_url, body, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data["principalType"], "group")
        self.assertEqual(res.data["principalId"], self.group.id)

    @override_settings(JANUS_DEFAULT_PAGE_EDIT=False, JANUS_DEFAULT_PAGE_VIEW=False)
    def test_create_invalid_principal_is_400(self):
        _make_user_perm("/docs", self.owner, "edit", "allow")
        self.client.force_authenticate(user=self.owner)
        body = {
            "path": "/docs",
            "principalType": "user",
            "principalId": 999999,
            "action": "view",
            "effect": "allow",
        }
        res = self.client.post(self.list_url, body, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    @override_settings(JANUS_DEFAULT_PAGE_EDIT=False, JANUS_DEFAULT_PAGE_VIEW=False)
    def test_patch_updates_effect_only(self):
        _make_user_perm("/docs", self.owner, "edit", "allow")
        entry = _make_user_perm("/docs", self.target_user, "view", "allow")
        self.client.force_authenticate(user=self.owner)
        res = self.client.patch(
            self._detail_url(entry.id),
            {"effect": "deny", "action": "edit", "path": "/other"},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        entry.refresh_from_db()
        self.assertEqual(entry.effect, "deny")
        # action/path は無視される。
        self.assertEqual(entry.action, "view")
        self.assertEqual(entry.path, "/docs")

    @override_settings(JANUS_DEFAULT_PAGE_EDIT=False, JANUS_DEFAULT_PAGE_VIEW=False)
    def test_patch_missing_entry_is_404(self):
        _make_user_perm("/docs", self.owner, "edit", "allow")
        self.client.force_authenticate(user=self.owner)
        res = self.client.patch(
            self._detail_url(999999), {"effect": "deny"}, format="json"
        )
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    @override_settings(JANUS_DEFAULT_PAGE_EDIT=False, JANUS_DEFAULT_PAGE_VIEW=False)
    def test_patch_delete_requires_edit_on_entry_path(self):
        entry = _make_user_perm("/docs", self.target_user, "view", "allow")
        # other は /docs の edit 権限なし → 403。
        self.client.force_authenticate(user=self.other)
        res_patch = self.client.patch(
            self._detail_url(entry.id), {"effect": "deny"}, format="json"
        )
        self.assertEqual(res_patch.status_code, status.HTTP_403_FORBIDDEN)
        res_del = self.client.delete(self._detail_url(entry.id))
        self.assertEqual(res_del.status_code, status.HTTP_403_FORBIDDEN)

    @override_settings(JANUS_DEFAULT_PAGE_EDIT=False, JANUS_DEFAULT_PAGE_VIEW=False)
    def test_delete_entry(self):
        _make_user_perm("/docs", self.owner, "edit", "allow")
        entry = _make_user_perm("/docs", self.target_user, "view", "allow")
        self.client.force_authenticate(user=self.owner)
        res = self.client.delete(self._detail_url(entry.id))
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(PagePermission.objects.filter(pk=entry.id).exists())


class EffectivePermissionApiTests(APITestCase):
    """実効権限 API（design 5.4）。401／常に 200+{view,edit}。"""

    def setUp(self):
        self.user_model = get_user_model()
        self.alice = self.user_model.objects.create_user(
            username="alice", password="pw-123456"
        )
        self.url = reverse("api:pages-effective-permission")

    def test_unauthenticated_is_401(self):
        res = self.client.get(self.url, {"path": "/docs"})
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_default_flags_true_true(self):
        self.client.force_authenticate(user=self.alice)
        res = self.client.get(self.url, {"path": "/docs"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data, {"view": True, "edit": True})

    @override_settings(
        JANUS_DEFAULT_PAGE_VIEW=False,
        JANUS_DEFAULT_PAGE_EDIT=False,
        JANUS_HIDE_FORBIDDEN=True,
    )
    def test_hidden_run_still_200_false_false(self):
        # 秘匿運用でも 403/404 を返さず {false,false}（存在を漏らさない）。
        self.client.force_authenticate(user=self.alice)
        res = self.client.get(self.url, {"path": "/secret"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data, {"view": False, "edit": False})

    @override_settings(JANUS_DEFAULT_PAGE_VIEW=False, JANUS_DEFAULT_PAGE_EDIT=False)
    def test_explicit_allow_true_true(self):
        _make_user_perm("/docs", self.alice, "view", "allow")
        _make_user_perm("/docs", self.alice, "edit", "allow")
        self.client.force_authenticate(user=self.alice)
        res = self.client.get(self.url, {"path": "/docs"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data, {"view": True, "edit": True})


class AssetApiNonInterferenceTests(APITestCase):
    """アセット/フォルダ API がフェーズ 2 適用後もフェーズ 1 挙動を維持する最小確認。"""

    def setUp(self):
        self.user_model = get_user_model()
        self.alice = self.user_model.objects.create_user(
            username="alice", password="pw-123456"
        )
        self.client.force_authenticate(user=self.alice)

    @override_settings(JANUS_DEFAULT_PAGE_VIEW=False, JANUS_DEFAULT_PAGE_EDIT=False)
    def test_folders_and_assets_unaffected_by_page_policy(self):
        # ページ非公開ポリシーでもフォルダ/アセット API は認可ゲート非対象で 200。
        res_folders = self.client.get(reverse("api:folders"))
        self.assertEqual(res_folders.status_code, status.HTTP_200_OK)
        res_assets = self.client.get(reverse("api:assets"))
        self.assertEqual(res_assets.status_code, status.HTTP_200_OK)
