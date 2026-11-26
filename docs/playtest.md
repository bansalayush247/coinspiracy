# Running a playtest

A playtest is the only way to learn whether the game is fun. The tests and simulations say the rules work; they can't
say whether a new player understands what to do, laughs at Glass, or gives up on the crowd in The Clock. Run a short
session with 5 to 10 friends, watch quietly, and let the in-game feedback do the counting.

## Before the session

1. **Host it where friends can reach it.** Either the production server (see `docs/deploy.md`), or a laptop on the same
   Wi-Fi: `npm run build`, then start the server and serve `apps/client/dist`, with `ALLOWED_ORIGINS` set to the
   address friends will open.
2. **Turn feedback on.** Set `FEEDBACK_DIR` to an absolute folder the server can write, for example
   `/var/lib/byzantine-council/feedback` under systemd (the only writable folder there). Without it the Feedback button
   still shows, but sending fails politely.
3. **Tag the build.** Build the client with `VITE_BUILD` set to something short, such as `VITE_BUILD=pt1`, so notes
   from this session can be told apart from later ones.
4. **Check it once yourself.** Open the game, press Feedback on the menu, send a test note, and confirm a line appears
   in `feedback-YYYY-MM-DD.jsonl`.

## The session (about 45 minutes)

| Time | What players do | What to watch |
|---|---|---|
| 0–5 min | Open the link, pick a name, look at the menu. Say nothing. | Where do they click first? Does anyone find the language picker? |
| 5–20 min | Each plays one story act alone: **The Dust** for new players, **The Clock** for anyone who has played before. | Do they read the dialogue or skip it? Where do they get stuck or caught? Do they understand why? |
| 20–35 min | Everyone joins one private council match by link (5 or more players). The host picks **Apprentice rules** for a first match. | Does the council vote make sense? Does anyone feel lost? Who has fun and who goes quiet? |
| 35–40 min | Everyone presses **How was it?** on the end card and sends a rating and a note. | Nothing: let them write. |
| 40–45 min | Ask the three questions below, out loud. | Write down exact words, not summaries. |

Rules for the host: don't explain, don't help unless someone is stuck for more than a minute, and never defend the
game. Every "I didn't get it" is a finding.

## Three questions to ask

1. What was the most fun moment?
2. When were you confused, and what did you think you were supposed to do?
3. Would you play again tomorrow? What would make you?

## Reading the feedback

Each note is one JSON line: the time to the minute, the 1–5 rating, the note, where it was sent from (`menu`, `match`,
`story:<act>`), the language and the build. Nothing identifies who sent it: no address, profile or cookie is stored.

```sh
cat /var/lib/byzantine-council/feedback/feedback-*.jsonl | jq -s 'group_by(.where) | map({where: .[0].where, notes: length, fun: ((map(.fun) | add) / length)})'
cat /var/lib/byzantine-council/feedback/feedback-*.jsonl | jq -r 'select(.build == "pt1") | "\(.fun)  \(.where)  \(.text)"'
```

The first line gives the average fun per place; the second lists every note from build `pt1`. Players may still type
something personal into a note despite the reminder, so treat the files as private and delete them when the playtest
is done.

## After the session

Write down the three biggest problems in plain words, then change tuning before code: most balance lives in the
`tuning/*.json` files (for example `tuning/book.json` for how quickly guardians are left alone in The Little Book).
Run the next session with a new `VITE_BUILD` tag and compare the averages.
