import json
from pathlib import Path

from api.db import get_connection, init_db
from api.main import QuestionIn, validate_question

SEED_PATH = Path(__file__).resolve().parent.parent / "seed" / "questions.json"


def main() -> None:
    items = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    payloads = []
    for item in items:
        payload = QuestionIn(**item)
        text = validate_question(payload)
        payloads.append((text, payload.options))

    init_db()
    inserted = 0
    skipped = 0

    with get_connection() as conn:
        for text, options in payloads:
            exists = conn.execute(
                "SELECT 1 FROM questions WHERE text = ? AND is_active = 1",
                (text,),
            ).fetchone()
            if exists:
                skipped += 1
                continue

            cur = conn.execute("INSERT INTO questions (text) VALUES (?)", (text,))
            question_id = cur.lastrowid
            for opt in options:
                conn.execute(
                    "INSERT INTO options (question_id, text, is_correct) VALUES (?, ?, ?)",
                    (question_id, opt.text.strip(), int(opt.is_correct)),
                )
            inserted += 1

    print(f"Seed concluído: {inserted} inseridas, {skipped} já existentes.")


if __name__ == "__main__":
    main()
