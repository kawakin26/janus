"""既存ページへ初回リビジョン（number=1）をバックフィルする（design 7）。

スキーマ変更は含まない追加専用のデータマイグレーション。既存全 Page に対し
``Revision.objects.filter(page=page).exists()`` ガードで未作成のページだけに
``number=1`` の初回リビジョンを作る（冪等）。本文空ページも対象。
``created_at`` は ``Page.updated_at``（auto_now=True で全既存行が非 null）を
無条件に明示代入し、author は ``Page.updated_by``（null 可）を引き継ぐ。

reverse（巻き戻し）は安全に実行できないため no-op とする。forward が作った
バックフィル分と、ランタイムで正当に作られた初版（number=1）を事後に区別する
印が無く、``number=1`` を一律削除すると実データ（各ページの正当な初版）を失う。
データ損失を避けるため、本データマイグレーションは実質的に不可逆として扱う。
"""

from django.db import migrations


def backfill_initial_revisions(apps, schema_editor):
    """既存全ページに number=1 の初回リビジョンを冪等に作る。"""
    Page = apps.get_model("api", "Page")
    Revision = apps.get_model("api", "Revision")
    for page in Page.objects.all().iterator():
        # 既にリビジョンがあるページはスキップ（二重作成防止・再実行冪等）。
        if Revision.objects.filter(page=page).exists():
            continue
        Revision.objects.create(
            page=page,
            number=1,
            body=page.body,
            title=page.title,
            # ヒストリカルモデルは auto_now_add フックを持たないため直接代入が効く。
            created_at=page.updated_at,
            author=page.updated_by,
        )


def remove_initial_revisions(apps, schema_editor):
    """reverse は no-op。

    forward 由来のバックフィルと、ランタイムで作られた正当な初版（number=1）を
    事後に区別できないため、``number=1`` の一律削除は実データ損失を招く。
    データ保全を優先し、巻き戻しでは何もしない（実質不可逆）。
    """
    # 意図的に何もしない（データ損失防止）。
    return


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0003_phase2_permissions_revisions"),
    ]

    operations = [
        migrations.RunPython(
            backfill_initial_revisions,
            remove_initial_revisions,
        ),
    ]
