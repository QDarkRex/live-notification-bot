import "dotenv/config";
import * as sqlite3 from "sqlite3";
import type { Database } from "sqlite3";
import { env } from "./envConfig";

// Initialize database with proper typing
const db: Database = new sqlite3.Database(env.DB_PATH);

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
