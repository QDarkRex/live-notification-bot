#!/usr/bin/env node
"use strict";

const HISTORY_URL = "https://idn-podium.idn-podium.workers.dev/api/history?limit=100&offset=0";

function matchHistory(session, records) {
  const exact = records.filter((record) => record.slug === session.slug && record.username === session.username);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const suffix = records.filter(
    (record) => session.slug.endsWith(`-${record.slug}`) && record.username === session.username,
  );
  return suffix.length === 1 ? suffix[0] : null;
}

function compareRows(sessions, records) {
  return sessions.map((session) => {
    const history = matchHistory(session, records);
    const firstAttached = session.first_attached_at == null ? null : new Date(session.first_attached_at).toISOString();
    const liveAt = history?.live_at ?? null;
    const flags = [];
    if (firstAttached && liveAt && Date.parse(firstAttached) > Date.parse(liveAt)) flags.push("joined_after_start");
    if (session.connect_count > 1 || session.disconnect_count > 0) flags.push("connection_gaps_possible");
    const result = {
      slug: session.slug,
      username: session.username,
      gold: session.gold,
      gifters: session.gifters,
      first_attached_at: firstAttached,
      live_at: liveAt,
      flags,
    };
    if (!history) return { ...result, status: "pending" };
    const deltaGold = session.gold - history.total_gold;
    const deltaGifters = session.gifters - history.total_gifters;
    return {
      ...result,
      status: deltaGold === 0 && deltaGifters === 0 ? "match_observed" : "difference_observed",
      idn_podium: { total_gold: history.total_gold, total_gifters: history.total_gifters },
      delta_gold: deltaGold,
      delta_gifters: deltaGifters,
    };
  });
}

function readDatabase(dbPath) {
  return new Promise((resolve, reject) => {
    const sqlite3 = require("sqlite3");
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (openError) => {
      if (openError) return reject(openError);
      const sql = `SELECT s.streamer_uuid, s.slug, s.username, s.first_attached_at,
        s.connect_count, s.disconnect_count, COALESCE(SUM(e.gold), 0) AS gold,
        COUNT(DISTINCT e.gifter_uuid) AS gifters
        FROM gift_chat_sessions s
        LEFT JOIN gift_chat_events e ON e.streamer_uuid = s.streamer_uuid AND e.slug = s.slug
        GROUP BY s.streamer_uuid, s.slug, s.username, s.first_attached_at, s.connect_count, s.disconnect_count`;
      db.all(sql, [], (queryError, rows) => {
        db.close((closeError) => {
          if (queryError) return reject(queryError);
          if (closeError) return reject(closeError);
          resolve(rows);
        });
      });
    });
  });
}

async function main(args) {
  const dbIndex = args.indexOf("--db");
  const dbPath = dbIndex >= 0 ? args[dbIndex + 1] : null;
  if (!dbPath || dbPath.startsWith("--"))
    throw new Error("Usage: node scripts/compare-chat-gifts.cjs --db <database-path>");

  const sessions = await readDatabase(dbPath);
  const response = await fetch(HISTORY_URL, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`IDN-Podium history returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.ok !== true || !Array.isArray(payload.records))
    throw new Error("Unexpected IDN-Podium history response");
  process.stdout.write(`${JSON.stringify(compareRows(sessions, payload.records), null, 2)}\n`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { compareRows, matchHistory };
