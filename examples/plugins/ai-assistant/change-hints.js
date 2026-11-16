// Completion time is observed once, never renewed by unrelated UI renders.
export function createChangeHints(now = () => Date.now(), duration = 20000) {
 const observed = new Map();
 return {
  select(entries, noteId) {
   const time = now(), ids = new Set(entries.map(entry => entry.id));
   for (const id of observed.keys()) if (!ids.has(id)) observed.delete(id);
   for (const entry of entries) {
    const previous = observed.get(entry.id);
    if (!previous) {
     const created = Date.parse(entry.createdAt);
     observed.set(entry.id, { state: entry.state, expiresAt: entry.state === 'pending' ? Infinity : (Number.isFinite(created) ? created : 0) + duration });
    } else if (previous.state !== entry.state) observed.set(entry.id, { state: entry.state, expiresAt: entry.state === 'pending' ? Infinity : time + duration });
   }
   if (!noteId) return null;
   const entry = [...entries].reverse().find(entry => entry.noteId === noteId && entry.state !== 'discarded' && observed.get(entry.id).expiresAt > time);
   return entry ? { ...entry, expiresAt: observed.get(entry.id).expiresAt } : null;
  },
 };
}
