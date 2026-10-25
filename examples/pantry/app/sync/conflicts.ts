// What sync needs of an item on any list: its id, when it last changed, and whether it is checked off.
export type Synced = { id: string; checked: boolean; updatedAt: number };

// Two phones edited the same item offline: the later updatedAt wins, and on a tie a checked item stays checked,
// since buying something twice costs more than seeing it once more. The server decides with this same function.
export function resolveConflict<T extends Synced>(mine: T, theirs: T): T {
  if (mine.updatedAt !== theirs.updatedAt) return mine.updatedAt > theirs.updatedAt ? mine : theirs;
  return mine.checked ? mine : theirs;
}

// The server's list with this phone's unsent edits laid over it. Each item is decided on its own, so neither phone
// loses the items the other added.
export function mergeLists<T extends Synced>(server: T[], local: T[]): T[] {
  const merged = new Map(server.map((item) => [item.id, item]));
  for (const item of local) {
    const theirs = merged.get(item.id);
    merged.set(item.id, theirs ? resolveConflict(item, theirs) : item);
  }
  return [...merged.values()];
}
