PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL CHECK (length(trim(text)) > 0),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,
    text TEXT NOT NULL CHECK (length(trim(text)) > 0),
    is_correct INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby', 'in_progress', 'won', 'lost')),
    deadline REAL,
    current_round INTEGER NOT NULL DEFAULT 1 CHECK (current_round BETWEEN 1 AND 3),
    current_attempt INTEGER NOT NULL DEFAULT 1 CHECK (current_attempt >= 1),
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS session_questions (
    session_id INTEGER NOT NULL,
    question_order INTEGER NOT NULL CHECK (question_order BETWEEN 1 AND 3),
    question_id INTEGER NOT NULL,
    PRIMARY KEY (session_id, question_order),
    UNIQUE (session_id, question_id),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 3),
    attempt INTEGER NOT NULL CHECK (attempt >= 1),
    player_id TEXT NOT NULL,
    option_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    UNIQUE (session_id, round, attempt, player_id),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (option_id) REFERENCES options(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS eliminated_options (
    session_id INTEGER NOT NULL,
    round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 3),
    option_id INTEGER NOT NULL,
    PRIMARY KEY (session_id, round, option_id),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (option_id) REFERENCES options(id) ON DELETE RESTRICT
);
