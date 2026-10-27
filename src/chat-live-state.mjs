export function isScrolledToBottom({ scrollTop, clientHeight, scrollHeight }, threshold = 40) {
  return scrollHeight - clientHeight - scrollTop <= threshold;
}

export function shouldSendTyping(lastSentAt, now, interval = 2000) {
  return now - lastSentAt >= interval;
}

export function activeTypingUsers(typingByUser, now, expiresAfter = 4000) {
  return [...typingByUser]
    .filter(([, timestamp]) => now - timestamp < expiresAfter)
    .map(([userId]) => userId);
}

export function compareMessageOrder(left, right) {
  const timestampOrder = new Date(left.created_at) - new Date(right.created_at);
  return timestampOrder || String(left.id).localeCompare(String(right.id));
}

export function readMessageCount(messages, lastReadSortId, excludedUserId = null, receipts = []) {
  if (!lastReadSortId) return 0;
  const readThrough = messages.findIndex((message) => message.id === lastReadSortId);
  if (readThrough < 0) return 0;
  const readerCount = receipts.filter((receipt) => (
    receipt.user_id !== excludedUserId
    && messages.findIndex((message) => message.id === receipt.last_read_sort_id) >= readThrough
  )).length;
  return readerCount;
}

export function totalUnreadCount(chats) {
  return chats.reduce((total, chat) => total + (Number(chat.unread_count) || 0), 0);
}

export function firstUnreadMessageId(messages, userId, lastReadAt) {
  const lastReadTime = Date.parse(lastReadAt);
  if (!Number.isFinite(lastReadTime)) return null;
  return messages.find((message) => (
    message.sender_id !== userId
    && Date.parse(message.created_at) > lastReadTime
  ))?.id ?? null;
}
