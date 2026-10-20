-- Same tables and column order as the Flask app's data.db, so exported rows load as they are.
-- New here: jobs.qr_png holds the QR image (the Mac kept a file path in qr_path), and meta holds locks and counters.
CREATE TABLE IF NOT EXISTS friends(
    id INTEGER PRIMARY KEY, token TEXT UNIQUE, name TEXT);
CREATE TABLE IF NOT EXISTS profiles(
    id INTEGER PRIMARY KEY, friend_id INTEGER, name TEXT, email TEXT,
    plate TEXT, state TEXT, make TEXT, model TEXT, color TEXT);
CREATE TABLE IF NOT EXISTS jobs(
    id INTEGER PRIMARY KEY, friend_id INTEGER, plate TEXT, state TEXT,
    make TEXT, model TEXT, color TEXT, email TEXT,
    start_ts REAL, end_ts REAL, expires_ts REAL, last_ok_ts REAL,
    status TEXT, fails INTEGER DEFAULT 0, error TEXT, confirmation TEXT, qr_path TEXT, who TEXT, next_try REAL,
    qr_png BLOB);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_friend ON jobs(friend_id);
CREATE INDEX IF NOT EXISTS profiles_friend ON profiles(friend_id);
CREATE TABLE IF NOT EXISTS meta(
    key TEXT PRIMARY KEY, value TEXT, until REAL);
