const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(process.cwd(), 'data', 'eburon.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Create SQLite database connection
const sqlite = new Database(DB_PATH);

// Enable WAL mode for better performance
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Initialize database tables
function initializeDatabase() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS transcriptions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      user_id TEXT,
      title TEXT,
      audio_file_name TEXT,
      audio_file_size INTEGER,
      audio_duration REAL,
      full_text TEXT,
      language TEXT DEFAULT 'en',
      model TEXT DEFAULT 'ggml-base.en',
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS segments (
      id TEXT PRIMARY KEY,
      transcription_id TEXT NOT NULL,
      segment_index INTEGER NOT NULL,
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      text TEXT NOT NULL,
      confidence REAL,
      words TEXT,
      created_at INTEGER,
      FOREIGN KEY (transcription_id) REFERENCES transcriptions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at ON transcriptions(created_at);
    CREATE INDEX IF NOT EXISTS idx_segments_transcription_id ON segments(transcription_id);
  `);

  console.log('Database initialized at:', DB_PATH);
}

// Helper functions
function getDatabaseStats() {
  return {
    users: sqlite.prepare('SELECT COUNT(*) as count FROM users').get().count,
    projects: sqlite.prepare('SELECT COUNT(*) as count FROM projects').get().count,
    transcriptions: sqlite.prepare('SELECT COUNT(*) as count FROM transcriptions').get().count,
    segments: sqlite.prepare('SELECT COUNT(*) as count FROM segments').get().count
  };
}

function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

module.exports = {
  sqlite,
  initializeDatabase,
  getDatabaseStats,
  generateId
};