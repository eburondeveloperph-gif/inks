const { sqliteTable, text, integer, real } = require('drizzle-orm/sqlite-core');
const { sql } = require('drizzle-orm');

// Users table - for future authentication
const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique(),
  name: text('name'),
  createdAt: integer('created_at'),
  updatedAt: integer('updated_at'),
});

// Projects table - organize transcriptions
const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: integer('created_at'),
  updatedAt: integer('updated_at'),
});

// Transcriptions table - main transcription records
const transcriptions = sqliteTable('transcriptions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id),
  userId: text('user_id').references(() => users.id),
  title: text('title'),
  
  // Audio metadata
  audioFileName: text('audio_file_name'),
  audioFileSize: integer('audio_file_size'),
  audioDuration: real('audio_duration'), // in seconds
  
  // Transcription results
  fullText: text('full_text'),
  language: text('language'),
  model: text('model'),
  
  // Status tracking
  status: text('status'),
  errorMessage: text('error_message'),
  
  // Timestamps
  createdAt: integer('created_at'),
  updatedAt: integer('updated_at'),
  completedAt: integer('completed_at'),
});

// Segments table - individual transcription segments with timestamps
const segments = sqliteTable('segments', {
  id: text('id').primaryKey(),
  transcriptionId: text('transcription_id').references(() => transcriptions.id),
  
  // Segment position
  segmentIndex: integer('segment_index'),
  
  // Timestamps
  startTime: real('start_time'),
  endTime: real('end_time'),
  
  // Content
  text: text('text'),
  confidence: real('confidence'),
  
  // Optional word-level timestamps
  words: text('words'),
  
  createdAt: integer('created_at'),
});

module.exports = {
  users,
  projects,
  transcriptions,
  segments
};