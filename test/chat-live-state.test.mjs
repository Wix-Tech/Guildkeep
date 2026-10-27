import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeTypingUsers,
  compareMessageOrder,
  isScrolledToBottom,
  readMessageCount,
  shouldSendTyping,
} from '../src/chat-live-state.mjs';

test('read acknowledgements require the user to reach the scroll bottom', () => {
  assert.equal(isScrolledToBottom({ scrollTop: 500, clientHeight: 300, scrollHeight: 800 }), true);
  assert.equal(isScrolledToBottom({ scrollTop: 450, clientHeight: 300, scrollHeight: 800 }), false);
  assert.equal(isScrolledToBottom({ scrollTop: 450, clientHeight: 300, scrollHeight: 800 }, 50), true);
});

test('typing sends are throttled to one event every two seconds', () => {
  assert.equal(shouldSendTyping(0, 1999), false);
  assert.equal(shouldSendTyping(0, 2000), true);
  assert.equal(shouldSendTyping(5000, 6999), false);
  assert.equal(shouldSendTyping(5000, 7000), true);
});

test('typing indicators expire after four seconds and exclude expired users', () => {
  const typing = new Map([['alex', 1000], ['sam', 999], ['lee', 0]]);
  assert.deepEqual(activeTypingUsers(typing, 4998), ['alex', 'sam']);
  assert.deepEqual(activeTypingUsers(typing, 4999), ['alex']);
  assert.deepEqual(activeTypingUsers(typing, 5000), []);
});

test('message read counts follow the latest-read cursor and deterministic message order', () => {
  const messages = [
    { id: 'm2', created_at: '2026-01-01T00:00:00Z' },
    { id: 'm1', created_at: '2026-01-01T00:00:00Z' },
    { id: 'm3', created_at: '2026-01-01T00:00:01Z' },
  ].sort(compareMessageOrder);
  assert.deepEqual(messages.map((message) => message.id), ['m1', 'm2', 'm3']);
  const receipts = [
    { user_id: 'reader-a', last_read_sort_id: 'm2' },
    { user_id: 'reader-b', last_read_sort_id: 'm3' },
    { user_id: 'self', last_read_sort_id: 'm3' },
  ];
  assert.equal(readMessageCount(messages, 'm2', 'self', receipts), 2);
  assert.equal(readMessageCount(messages, 'm3', 'self', receipts), 1);
});
