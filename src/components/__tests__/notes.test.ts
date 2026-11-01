import { describe, expect, it } from 'vitest';

import { noteColorClass, sortNotes } from '../notes';
import type { NoteItem } from '../../types/schemas';

/** Build a fully-formed note from minimal overrides. */
function makeNote(
  overrides: Partial<NoteItem> & Pick<NoteItem, 'id' | 'title' | 'updated_at'>,
): NoteItem {
  return {
    created_at: overrides.updated_at,
    profile_id: 'p1',
    content: '',
    ...overrides,
  };
}

describe('sortNotes', () => {
  it('orders notes by most recently updated first', () => {
    const notes: NoteItem[] = [
      makeNote({ id: 'old', title: 'Old', updated_at: 1 }),
      makeNote({ id: 'new', title: 'New', updated_at: 3 }),
      makeNote({ id: 'mid', title: 'Mid', updated_at: 2 }),
    ];

    expect(sortNotes(notes).map((n) => n.id)).toEqual(['new', 'mid', 'old']);
  });

  it('places pinned notes before unpinned ones', () => {
    const notes: NoteItem[] = [
      makeNote({ id: 'a', title: 'A', updated_at: 3 }),
      makeNote({ id: 'b', title: 'B', updated_at: 1, is_pinned: true }),
    ];

    expect(sortNotes(notes).map((n) => n.id)).toEqual(['b', 'a']);
  });

  it('orders by manual `order` before recency', () => {
    const notes: NoteItem[] = [
      makeNote({ id: 'a', title: 'A', updated_at: 3, order: 2 }),
      makeNote({ id: 'b', title: 'B', updated_at: 1, order: 1 }),
    ];

    expect(sortNotes(notes).map((n) => n.id)).toEqual(['b', 'a']);
  });

  it('does not mutate the input array', () => {
    const notes: NoteItem[] = [
      makeNote({ id: 'a', title: 'A', updated_at: 1 }),
      makeNote({ id: 'b', title: 'B', updated_at: 2 }),
    ];
    const snapshot = notes.map((n) => n.id);

    sortNotes(notes);

    expect(notes.map((n) => n.id)).toEqual(snapshot);
  });
});

describe('noteColorClass', () => {
  it('maps known color tags to their class', () => {
    expect(noteColorClass('terracotta')).toBe('note--terracotta');
    expect(noteColorClass('sage')).toBe('note--sage');
    expect(noteColorClass('amber')).toBe('note--amber');
    expect(noteColorClass('burgundy')).toBe('note--burgundy');
  });

  it('maps the legacy neutral tag and unknown tags to default', () => {
    expect(noteColorClass('neutral')).toBe('note--default');
    expect(noteColorClass(undefined)).toBe('note--default');
    expect(noteColorClass('chartreuse')).toBe('note--default');
  });
});
