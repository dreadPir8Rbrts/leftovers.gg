"""Add naruto_ccg to game check constraints on expansions_v2 and cards_v2.

Revision ID: 0041
Revises: 0040
"""

from alembic import op

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_expansions_v2_game", "expansions_v2", schema="public")
    op.create_check_constraint(
        "ck_expansions_v2_game",
        "expansions_v2",
        "game IN ('pokemon', 'onepiece', 'naruto_ccg')",
        schema="public",
    )

    op.drop_constraint("ck_cards_v2_game", "cards_v2", schema="public")
    op.create_check_constraint(
        "ck_cards_v2_game",
        "cards_v2",
        "game IN ('pokemon', 'onepiece', 'naruto_ccg')",
        schema="public",
    )


def downgrade() -> None:
    op.drop_constraint("ck_cards_v2_game", "cards_v2", schema="public")
    op.create_check_constraint(
        "ck_cards_v2_game",
        "cards_v2",
        "game IN ('pokemon', 'onepiece')",
        schema="public",
    )

    op.drop_constraint("ck_expansions_v2_game", "expansions_v2", schema="public")
    op.create_check_constraint(
        "ck_expansions_v2_game",
        "expansions_v2",
        "game IN ('pokemon', 'onepiece')",
        schema="public",
    )
