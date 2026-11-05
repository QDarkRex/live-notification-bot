# IDN chat gifts: shadow validation

Chat gifts are collected separately from the daily top-rank snapshots. The
existing top-rank tracker remains the source for `/supporter` and end-live
embeds. There is no automatic switch or addition of chat totals to poll totals.

## Observed wire format, 4 November 2026

A bounded live capture joined Virgi, Maira and Ribka's actual IDN rooms. One
initial gift was captured from Maira; a subsequent five-minute capture used two
observer sockets and received 34 gift frames representing 17 distinct events.
All 17 events had the same `msgid` and monetary/room identity on both sockets;
one event had slightly different IRC time tags. The 17 unique events contained
372 Gold. All weights in this initial sample were 1. A later weight-10 example
is documented below; weight must not be assumed to multiply Gold.

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
- The first stored IRC time tag determines the row's WIB day. These tags can
  vary between deliveries; they are not certified transaction timestamps.
  A replay with the same ID cannot insert another row even if its time tag
  crosses midnight. Session totals can span midnight. Arrival time is retained
  only as capture evidence.
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

## First finished-session comparison

On 4 November around 21:05 WIB, Michie's session `261104202016` was no longer
listed live and could be compared. Chat held 887 Gold / 3,548 Points from 13
gifters; the existing poll-based session calculation held 888 / 3,552 from 13.
The idn-podium record also reported 888 Gold and 13 gifters. This comparison did
not pass exact agreement.

One gifter accounted for the entire difference: polling held 3 Gold / 12 Points,
while chat contained one 2-Gold / 8-Point event. The listener attached about
three seconds after the reported start and recorded 11 unexpected disconnects
with healthy reconnects. These are possible capture gaps, but the evidence does
not establish when an extra 1-Gold event occurred or prove which source caused
the discrepancy. No synthetic correction was applied. The primary source was
not switched to chat.

## Controlled audit and overnight results

Two local observers watched nine member rooms on 4 November, 21:19:22–21:27:22
WIB. They recorded 109 frames representing 56 unique gifts (1,796 Gold in the
payloads); 53 IDs were seen by both observers. Their monetary payloads agreed.
The bot contained 55 of those exact IDs with matching Gold and Point values.
One Elin gift of 5 Gold / 20 Points was absent at the audit query and remained
absent in the 5 November read-only check. No duplicate rows or monetary value
mismatches were found for the matched IDs.

IRC time tags differed on 47 dual-observed IDs; 19 bot/observer comparisons
also had timestamp-only differences. These must not be reported as Gold
mismatches. The Elin IRC tag, local receive times and bot disconnect log use
different clock domains, so proximity alone does not establish exactly why
that event was not recorded. Both observers also reconnected: their union is
evidence for observed events, not proof of a complete feed.

A Gracie `MELUNCUR!!` gift had `gold: 599`, `point: 2396`, `weight: 10`.
For that gifter, both the stored poll calculation and chat held 619 Gold from
the observed 599 + 20 contributions. This supports using the Gold field once
for this real example; multiplying it by 10 would contradict those totals.

The 5 November comparison found 21 finished active-member sessions: eight
matched idn-podium exactly, while 13 had lower chat Gold totals. No positive
Gold difference appeared in this sample. All carried late-attachment and
possible-gap flags, and the largest reference room had 42 gifters. This does
not validate full coverage or a room with more than 50 gifters. Chat remains
shadow-only; no totals were repaired to force agreement.

An anonymous protocol check on 5 November returned numeric 421 (unknown
command) for `CHATHISTORY`. The advertised capabilities also lacked a history
capability. This did not establish a usable replay method; no unverified
history recovery was implemented.

## Manual comparison

```sh
node scripts/compare-chat-gifts.cjs --db /absolute/path/to/whitelist.db
```

This requires an explicit existing database path, opens SQLite read-only, runs
one query, and closes it before fetching the latest 100 idn-podium history
records and IDN's current live list. It does not poll the database. Run it
against a local copy when practical. It reports observed Gold/gifter deltas,
late attachment and possible connection gaps. A session still listed live on
IDN remains pending even if idn-podium already has a matching history record;
records without a valid end timestamp also remain pending. History may
store only the timestamp suffix of a slug, so a unique suffix match also
requires the same member username. Older lives outside this page remain pending.

On 4 November around 20:39 WIB, matching Danella and Intan history records
existed while IDN's live list still included both sessions. Comparing their
ongoing chat totals to those records produced provisional differences. A
history match alone therefore must not be interpreted as a finished-live
comparison. The tool fails if current live status cannot be checked rather than
assuming every history match is final.

Back up the production database before deploying the new chat tables and the
missing-member warning table. Deployment requires owner approval.
