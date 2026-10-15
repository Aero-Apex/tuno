import { EventEmitter } from 'node:events';

export type TunoEvent =
  | { type: 'job'; job: unknown }
  | { type: 'jobs-cleared' }
  | { type: 'library' }
  | { type: 'playlists' };

const bus = new EventEmitter();
bus.setMaxListeners(200);

/** Sends an event to one account's open apps (null = everyone, e.g. after admin changes). */
export function emit(userId: number | null, event: TunoEvent) {
  bus.emit('event', userId, event);
}

/** Receives only the events for this account. */
export function subscribe(userId: number, fn: (event: TunoEvent) => void): () => void {
  const listener = (target: number | null, event: TunoEvent) => {
    if (target === null || target === userId) fn(event);
  };
  bus.on('event', listener);
  return () => bus.off('event', listener);
}
