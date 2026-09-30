import { beforeEach, describe, expect, it } from 'vitest';
import { clearAssistantChats, readSavedChat, saveChat } from '../assistant-chat-storage.js';

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
});
