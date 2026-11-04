# IDN chat gifts: shadow validation

Chat gifts are collected separately from the daily top-rank snapshots. The
existing top-rank tracker remains the source for `/supporter` and end-live
embeds. There is no automatic switch or addition of chat totals to poll totals.

## Observed wire format, 4 November 2026

A bounded live capture joined Virgi, Maira and Ribka's actual IDN rooms. One
initial gift was captured from Maira; a subsequent five-minute capture used two
observer sockets and received 34 gift frames representing 17 distinct events.
All 17 events had the same `msgid`, server `time` and payload on both sockets.
The 17 unique events contained 372 Gold. All observed `gift.weight` values were
1; a quantity multiplier has not been demonstrated and must not be invented.

Shape of a real Maira broadcast (gifter identity replaced in this example):

```text
@time=2026-11-04T12:11:03.331Z;msgid=201~1792744405~5091084 :IDNOdin!IDNOdin@serverop.idn.app PRIVMSG #arn:aws:ivschat:us-east-1:050891932989:room/E3NDetuVTDVI :{"user":{"name":"Example gifter","uuid":"00000000-0000-4000-8000-000000000001"},"gift":{"name":"Outt!","slug":"outt-1714103966","gold":11,"point":44,"weight":1},"room_id":"lets-go-261104182414"}
```

The omitted fields were avatar/level and gift animation/display attributes.
`room_id` in the JSON is the live slug; the IRC channel is the separate chat
room ARN. The gifter is `user`, not the streamer. The owning streamer UUID
comes from the watched live session.

Two top-rank snapshots around 19:14–19:18 WIB showed increases of 204 Gold for
Virgi and 48 for Ribka, matching observed gifts during that interval. Maira's
observed 61 Gold exceeded the snapshot increase of 32: one new 29-Gold gifter
was absent from the latter reply. A follow-up at 19:20 WIB contained that
gifter with 58 Gold. This does not establish the exact earlier snapshot's
freshness or prove that chat is authoritative. These short windows are not
whole-live validation.

## Preventing duplicate accounting

- `gift_chat_events` has a unique key of streamer UUID, live slug and IRC
  `msgid`. A replay on another connection, reconnect or bot restart cannot add
  the same stored event twice. Another genuine message ID remains distinct,
  even if its sender, gift and timestamp match an earlier gift.
- A single insert stores the event; totals are SQL sums over stored events.
  There is no separate incremental counter that can diverge after a crash.
- The event's server timestamp determines its WIB day. A replay received after
  midnight remains assigned to its original day, and session totals can span
  midnight. Arrival time is retained only as capture evidence.
- Missing stable message IDs or invalid gift data are rejected and logged.
  There is no guessed deduplication key. Only the expected IDNOdin sender,
  channel and live slug are accepted.
- SQLite busy errors use bounded retries. Permanent write failures are logged.

The shared IDN chat transport feeds the gift ledger. The `ws` package is
required for gift capture.

## What still needs proof

The capture started after these lives began. It cannot establish whole-live
totals against idn-podium. A disconnected listener cannot recover unseen chat
messages merely by reconnecting, and a bot restart creates another possible
gap. `gift_chat_sessions` records attachment times and connection counters so
the comparison does not hide those limitations. A matching total is an
observation, not a guarantee of complete delivery or stable IDs in every future
IDN implementation.

Keep polling authoritative until several finished lives have been compared,
including busy rooms with more than 50 gifters, and investigate differences.
Switching the displayed totals is a separate change after this evidence exists.

## Manual comparison

```sh
node scripts/compare-chat-gifts.cjs --db /absolute/path/to/whitelist.db
```

This requires an explicit existing database path, opens SQLite read-only, runs
one query, and closes it before making one request for the latest 100 finished
lives from idn-podium. It does not poll the database. Run it against a local
copy when practical. It reports observed Gold/gifter deltas, late attachment
and possible connection gaps; unmatched sessions remain pending. History may
store only the timestamp suffix of a slug, so a unique suffix match also
requires the same member username. Older lives outside this page remain pending.

Back up the production database before deploying the new chat tables and the
missing-member warning table. Deployment requires owner approval.
