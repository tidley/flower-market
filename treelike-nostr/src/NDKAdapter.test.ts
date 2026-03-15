import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Callback, Unsubscribe } from '../../treelike/src';
import { NDKAdapter, PublicKey } from '.';
import { NostrEvent, NostrFilter } from './types';

describe('NDKAdapter', () => {
  let adapter: NDKAdapter;
  let publish: ReturnType<typeof vi.fn>;
  let subscribe: ReturnType<typeof vi.fn>;
  let onEvent: ((event: NostrEvent) => void) | undefined;
  let author: PublicKey;
  let unsubscribed = false;

  beforeEach(() => {
    unsubscribed = false;
    author = new PublicKey(
      'npub1g53mukxnjkcmr94fhryzkqutdz2ukq4ks0gvy5af25rgmwsl4ngq43drvk',
    );
    publish = vi.fn();
    subscribe = vi.fn((filter: NostrFilter, handler: (event: NostrEvent) => void) => {
      onEvent = handler;
      return () => {
        unsubscribed = true;
      };
    });

    adapter = new NDKAdapter(publish, subscribe, [author]);
  });

  describe('get()', () => {
    it('subscribes for a path and forwards matching values', () => {
      const mockCallback: Callback = vi.fn();
      const unsubscribe: Unsubscribe = adapter.get('somePath', mockCallback);

      expect(subscribe).toHaveBeenCalledWith(
        {
          authors: [author.toString()],
          kinds: [30078],
          '#d': ['somePath'],
        },
        expect.any(Function),
      );

      onEvent?.({
        id: 'event-id',
        pubkey: author.toString(),
        created_at: 123,
        kind: 30078,
        tags: [['d', 'somePath'], ['f', '']],
        content: JSON.stringify('someValue'),
        sig: 'sig',
      });

      expect(mockCallback).toHaveBeenCalledWith(
        'someValue',
        `${author.npub}somePath`,
        123000,
        expect.any(Function),
      );

      const callbackUnsubscribe = vi.mocked(mockCallback).mock.calls[0]?.[3];
      expect(typeof callbackUnsubscribe).toBe('function');
      callbackUnsubscribe?.();
      expect(unsubscribed).toBe(true);

      unsubscribe();
      expect(unsubscribed).toBe(true);
    });
  });

  describe('set()', () => {
    it('publishes a replaceable nostr event with path metadata', async () => {
      await adapter.set('anotherPath', { value: 'newValue', updatedAt: 456000, expiresAt: 789000 });

      expect(publish).toHaveBeenCalledWith({
        kind: 30078,
        content: JSON.stringify('newValue'),
        created_at: 456,
        tags: [
          ['d', 'anotherPath'],
          ['f', ''],
          ['expiration', '789'],
        ],
      });
    });
  });

  describe('list()', () => {
    it('subscribes for direct children and ignores deeper descendants', () => {
      const mockCallback: Callback = vi.fn();
      const unsubscribe: Unsubscribe = adapter.list('parent', mockCallback);

      expect(subscribe).toHaveBeenCalledWith(
        {
          authors: [author.toString()],
          kinds: [30078],
        },
        expect.any(Function),
      );

      onEvent?.({
        id: 'child-1',
        pubkey: author.toString(),
        created_at: 100,
        kind: 30078,
        tags: [['d', 'parent/child1'], ['f', 'parent']],
        content: JSON.stringify('childValue1'),
        sig: 'sig',
      });
      onEvent?.({
        id: 'child-2',
        pubkey: author.toString(),
        created_at: 101,
        kind: 30078,
        tags: [['d', 'parent/child2'], ['f', 'parent']],
        content: JSON.stringify('childValue2'),
        sig: 'sig',
      });
      onEvent?.({
        id: 'grandchild',
        pubkey: author.toString(),
        created_at: 102,
        kind: 30078,
        tags: [['d', 'parent/child1/grandchild'], ['f', 'parent/child1']],
        content: JSON.stringify('ignored'),
        sig: 'sig',
      });

      expect(mockCallback).toHaveBeenCalledTimes(2);
      expect(mockCallback).toHaveBeenNthCalledWith(
        1,
        'childValue1',
        `${author.npub}parent/child1`,
        100000,
        expect.any(Function),
      );
      expect(mockCallback).toHaveBeenNthCalledWith(
        2,
        'childValue2',
        `${author.npub}parent/child2`,
        101000,
        expect.any(Function),
      );

      unsubscribe();
      expect(unsubscribed).toBe(true);
    });
  });
});
