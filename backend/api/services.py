"""ページ保存の単一経路（design 6.1「保存の単一経路」）。

作成（POST）・更新（PUT）・復元（restore）の 3 入口を 1 つのサービス関数
``save_page_body`` に集約し、「``Page.body`` 更新」「重複判定」「連番採番」
「初回リビジョン」の整合を 1 つの ``transaction.atomic()`` 内で所有する
（要件 P2-8-6）。不変条件「最新リビジョン（number 最大）の body == ``Page.body``」
はこの経路のみが維持する（design 2.3）。
"""

from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import Page, Revision
from .utils import normalize_path


class PathConflictError(Exception):
    """作成経路で path 重複（``IntegrityError``）を検知したことを表す。

    ビューはこの型を捕捉して既存の 409（``DUPLICATE_PATH_DETAIL``）に変換する。
    サービス層の atomic とビュー層の try を型で橋渡しし、409 分岐を一貫させる
    （design 6.1 MEDIUM-5）。
    """


def save_page_body(page_or_path, *, title, body, author):
    """ページ本文を保存し ``(page, created_revision_bool)`` を返す（design 6.1）。

    第 1 引数が既存 ``Page`` インスタンスなら更新/復元経路、文字列（path）なら
    作成経路として分岐する。全体を単一トランザクションで包む。

    - 作成（新規 path）: ``Page.objects.create`` で作成し、``created_by``/
      ``updated_by`` の双方を author に設定する。最新リビジョンが無いので常に
      ``number=1`` の初回リビジョンを作る（design 6.2）。path 重複は
      ``PathConflictError`` に包んで送出する。
    - 更新/復元（既存 path）: ``select_for_update()`` で行ロックし ``number`` 採番を
      直列化する。``created_by`` は保持し ``updated_by`` のみ author に更新する。
    - 本文不変（design 6.3）: 最新リビジョン body == 新 body なら新リビジョンを
      作らない。title のみ変化時は ``Page.title`` を更新して ``save()``（``updated_at``
      は動く）。body も title も不変なら ``Page.save()`` を呼ばず ``updated_at`` を
      動かさない。いずれも ``(page, False)`` を返す。
    - 本文変化あり: ``number = (最新 number or 0) + 1`` の ``Revision`` を作り、
      ``Page.body``/``title``/``updated_by`` を更新して ``save()``、``(page, True)`` を返す。
    """
    with transaction.atomic():
        if isinstance(page_or_path, Page):
            # 更新/復元経路: 既存行を行ロックして採番を直列化する。
            page = Page.objects.select_for_update().get(pk=page_or_path.pk)
            created_page = False
        else:
            # 作成経路: ロック対象の行がまだ無い。unique 制約が直列化を担保する。
            path = normalize_path(page_or_path)
            try:
                page = Page.objects.create(
                    path=path,
                    title=title,
                    body=body,
                    created_by=author,
                    updated_by=author,
                )
            except IntegrityError as exc:
                raise PathConflictError(path) from exc
            created_page = True

        latest = page.revisions.order_by("-number").first()

        if not created_page and latest is not None and latest.body == body:
            # 本文不変 → リビジョンを作らない（design 6.3）。
            if page.title != title:
                # タイトルのみ変更: Page.title を更新（updated_at は動く）。
                page.title = title
                page.updated_by = author
                page.save()
            # body も title も不変なら Page.save() を呼ばず updated_at を動かさない。
            return page, False

        # 本文変化あり（作成経路は latest が None なので必ずここに入る）。
        number = (latest.number if latest is not None else 0) + 1
        Revision.objects.create(
            page=page,
            number=number,
            body=body,
            title=title,
            created_at=timezone.now(),
            author=author,
        )
        if created_page:
            # 作成経路は create() で body/title/created_by/updated_by 設定済み。
            # 本文一致（番号採番）のみ済ませ、二重 save() はしない。
            return page, True
        page.body = body
        page.title = title
        page.updated_by = author
        page.save()
        return page, True
