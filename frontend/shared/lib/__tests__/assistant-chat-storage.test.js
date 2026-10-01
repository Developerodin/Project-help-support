import { beforeEach, describe, expect, it } from 'vitest';
import {
  archiveChat, clearAssistantChats, readRecentChats, readSavedChat, saveChat, takeRecentChat,
} from '../assistant-chat-storage.js';

describe('assistant chat storage', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('keeps each person\'s chat under their own key', () => {
    saveChat('u1', [{ role: 'user', content: 'mine' }]);
    expect(readSavedChat('u1')).toEqual([{ role: 'user', content: 'mine' }]);
    expect(readSavedChat('u2')).toEqual([]);
    expect(readSavedChat(null)).toEqual([]);
  });

  it('sign-out clears every saved chat, including old unkeyed saves', () => {
    saveChat('u1', [{ role: 'user', content: 'a' }]);
    saveChat('u2', [{ role: 'user', content: 'b' }]);
    window.sessionStorage.setItem('assistant.chat', '[]');
    window.sessionStorage.setItem('unrelated', 'stay');
    clearAssistantChats();
    expect(window.sessionStorage.length).toBe(1);
    expect(window.sessionStorage.getItem('unrelated')).toBe('stay');
  });

  it('a user switch keeps only the current person\'s chat', () => {
    saveChat('u1', [{ role: 'user', content: 'a' }]);
    saveChat('u2', [{ role: 'user', content: 'b' }]);
    clearAssistantChats('u2');
    expect(readSavedChat('u1')).toEqual([]);
    expect(readSavedChat('u2')).toHaveLength(1);
  });

  it('sets chats aside newest first, keeps five, and cancels drafts that were still waiting', () => {
    for (let i = 1; i <= 6; i += 1) {
      archiveChat('u1', [
        { role: 'user', content: `Question ${i}` },
        { role: 'assistant', content: 'Draft below.', actions: [{ id: `a${i}`, type: 'comment', status: 'pending' }] },
      ], new Date(2026, 9, 1, 10, i));
    }
    const chats = readRecentChats('u1');
    expect(chats.map((chat) => chat.title)).toEqual(['Question 6', 'Question 5', 'Question 4', 'Question 3', 'Question 2']);
    expect(chats[0].messages[1].actions[0].status).toBe('dismissed');
    expect(readRecentChats('u2')).toEqual([]);
  });

  it('does not keep a chat with no question in it', () => {
    archiveChat('u1', [{ role: 'assistant', content: 'Cancelled.' }]);
    expect(readRecentChats('u1')).toEqual([]);
  });

  it('takes a chat out of the list to reopen it', () => {
    archiveChat('u1', [{ role: 'user', content: 'First' }]);
    const [chat] = readRecentChats('u1');
    expect(takeRecentChat('u1', chat.id).messages).toEqual([{ role: 'user', content: 'First' }]);
    expect(readRecentChats('u1')).toEqual([]);
    expect(takeRecentChat('u1', chat.id)).toBeNull();
  });

  it('clears another person\'s earlier chats along with their current one', () => {
    archiveChat('u1', [{ role: 'user', content: 'Ada only' }]);
    clearAssistantChats('u2');
    expect(readRecentChats('u1')).toEqual([]);
  });
});
