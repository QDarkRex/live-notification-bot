import "dotenv/config";
import * as sqlite3 from "sqlite3";
import type { Database } from "sqlite3";
import { env } from "./envConfig";

// Initialize database with proper typing
const db: Database = new sqlite3.Database(env.DB_PATH);
// Wait for a lock (e.g. someone inspecting the file) instead of failing writes with SQLITE_BUSY.
db.configure("busyTimeout", 5000);

// Define table schemas with type safety
const tableSchemas = [
  `CREATE TABLE IF NOT EXISTS whitelist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL
    )`,

  `CREATE TABLE IF NOT EXISTS showroom_live (
        id INTEGER PRIMARY KEY, 
        live_id TEXT UNIQUE, 
        displayName TEXT,
        room_url_key TEXT,
        image_square TEXT, 
        image TEXT, 
        main_name TEXT,
        startLive TEXT  
    )`,

  `CREATE TABLE IF NOT EXISTS idn_live (
        id INTEGER PRIMARY KEY, 
        user_id TEXT UNIQUE,
        username TEXT,
        name TEXT, 
        avatar TEXT, 
        image_url TEXT,
        slug TEXT,
        follower_count TEXT,
        startLive TEXT
    )`,

  `CREATE TABLE IF NOT EXISTS tag_roles (
        guild_id TEXT PRIMARY KEY,
        role_id TEXT NOT NULL
    )`,

  `CREATE TABLE IF NOT EXISTS theater_schedule (
        id INTEGER PRIMARY KEY,
        setlist TEXT,
        showInfo TEXT,
        members TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,

  `CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        eventName TEXT UNIQUE
    )`,

  `CREATE TABLE IF NOT EXISTS schedule_id (
        guild_id TEXT,
        channel_id TEXT,
        PRIMARY KEY (guild_id)
    )`,

  `CREATE TABLE IF NOT EXISTS news (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        berita_id TEXT UNIQUE
    )`,

  `CREATE TABLE IF NOT EXISTS top_gifts (
        uuid TEXT NOT NULL,
        rank INTEGER NOT NULL,
        name TEXT NOT NULL,
        total_gold INTEGER NOT NULL,
        total_point INTEGER NOT NULL,
        PRIMARY KEY (uuid, rank)
    )`,

  // Gift tracker (giftTracker.ts): one row per IDN daily-ranking period.
  `CREATE TABLE IF NOT EXISTS gift_periods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        streamer_uuid TEXT NOT NULL,
        day TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    )`,

  "CREATE INDEX IF NOT EXISTS idx_gift_periods_streamer ON gift_periods (streamer_uuid, id)",

  "CREATE INDEX IF NOT EXISTS idx_gift_periods_day ON gift_periods (day)",

  `CREATE TABLE IF NOT EXISTS gift_period_totals (
        period_id INTEGER NOT NULL,
        gifter_uuid TEXT NOT NULL,
        gifter_name TEXT NOT NULL,
        total_gold INTEGER NOT NULL,
        total_point INTEGER NOT NULL,
        PRIMARY KEY (period_id, gifter_uuid)
    )`,

  `CREATE TABLE IF NOT EXISTS gift_sessions (
        slug TEXT PRIMARY KEY,
        streamer_uuid TEXT NOT NULL,
        start_period_id INTEGER NOT NULL,
        started_at INTEGER NOT NULL
    )`,

  `CREATE TABLE IF NOT EXISTS gift_session_baseline (
        slug TEXT NOT NULL,
        gifter_uuid TEXT NOT NULL,
        total_gold INTEGER NOT NULL,
        total_point INTEGER NOT NULL,
        PRIMARY KEY (slug, gifter_uuid)
    )`,

  `CREATE TABLE IF NOT EXISTS gift_chat_events (
        streamer_uuid TEXT NOT NULL,
        slug TEXT NOT NULL,
        msgid TEXT NOT NULL,
        event_at INTEGER NOT NULL,
        received_at INTEGER NOT NULL,
        day TEXT NOT NULL,
        gifter_uuid TEXT NOT NULL,
        gifter_name TEXT NOT NULL,
        gold INTEGER NOT NULL,
        point INTEGER NOT NULL,
        PRIMARY KEY (streamer_uuid, slug, msgid)
    )`,

  `CREATE TABLE IF NOT EXISTS gift_chat_sessions (
        streamer_uuid TEXT NOT NULL,
        slug TEXT NOT NULL,
        username TEXT NOT NULL,
        first_attached_at INTEGER,
        last_attached_at INTEGER,
        connect_count INTEGER NOT NULL,
        disconnect_count INTEGER NOT NULL,
        PRIMARY KEY (streamer_uuid, slug)
    )`,

  `CREATE TABLE IF NOT EXISTS idn_streamers (
        uuid TEXT PRIMARY KEY,
        username TEXT,
        name TEXT,
        updated_at INTEGER
    )`,

  `CREATE TABLE IF NOT EXISTS idn_missing_member_warnings (
        uuid TEXT PRIMARY KEY,
        day TEXT NOT NULL
    )`,

  `CREATE TABLE IF NOT EXISTS webhook (
        url TEXT,
        user_id TEXT,
        guild_id TEXT
    )`,
];

// Database initialization with error handling
db.serialize(() => {
  tableSchemas.forEach((schema) => {
    db.run(schema, (err) => {
      if (err) {
        console.error(`Error creating table (${schema.substring(13, 30)}...):`, err.message);
      }
    });
  });
});

// Export the typed database instance
export default db;
