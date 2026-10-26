# Offline sync
Lists work offline. The server side is `putItems()` in `api/routes/shopping.ts`.

## 1. Queue
Every edit goes through `enqueue()` in `app/sync/queue.ts` and stays in storage until the server confirms it.

## 2. Rounds
`syncNow()` in `app/sync/sync.ts` sends the queue, takes the list back and lays edits made meanwhile over it.
`startSync()` runs a round when the phone comes online and every 30 seconds.

## 3. Conflicts
`resolveConflict()` in `app/sync/conflicts.ts` decides each item on its own: the later `updatedAt` wins, and on a tie
a checked item stays checked. The server calls the same function, so phones and server agree.
