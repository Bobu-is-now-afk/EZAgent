import { randomUUID } from 'node:crypto'
import type { RunEvent } from './contracts'

export type NewRunEvent = Omit<RunEvent, 'id' | 'sequence' | 'time'>

export function createNextRunEvent(
  priorEvents: readonly RunEvent[],
  input: NewRunEvent,
  time = new Date().toISOString(),
): RunEvent {
  const previousSequence = priorEvents.at(-1)?.sequence ?? 0
  return {
    ...input,
    id: randomUUID(),
    sequence: previousSequence + 1,
    time,
  }
}

export function eventsAfter(
  events: readonly RunEvent[],
  afterSequence: number,
): { events: RunEvent[]; nextSequence: number } {
  const latestSequence = events.at(-1)?.sequence ?? 0
  return {
    events: events.filter((event) => event.sequence > afterSequence),
    nextSequence: latestSequence,
  }
}
