import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { renderHook } from '@testing-library/react';
import VoiceMode, { useLevelVar } from './voice-mode.jsx';

const setup = (over = {}) => {
  const props = {
    phase: 'listening',
    heard: '',
    reply: '',
    draft: null,
    draftReady: true,
    onConfirmDraft: vi.fn(),
    onCancelDraft: vi.fn(),
    onEditDraft: vi.fn(),
    onInterrupt: vi.fn(),
    micLevel: { current: 0 },
    outputLevel: { current: 0 },
    onEnd: vi.fn(),
    onShowChat: vi.fn(),
    ...over,
  };
  render(<VoiceMode {...props} />);
  return props;
};

describe('VoiceMode', () => {
  it('a report shows as a short block with a way to open it in chat and to download it', () => {
    const report = { title: 'Web App (WEB) report', period: '16 Sep – 23 Sep 2026', download: vi.fn() };
    const props = setup({ report, onShowReport: vi.fn() });
    const block = screen.getByRole('group', { name: 'Web App (WEB) report' });
    expect(block.textContent).toContain('16 Sep – 23 Sep 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Show report' }));
    expect(props.onShowReport).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(report.download).toHaveBeenCalled();
  });

  it('while playing its exit, the dock is hidden from assistive tech and Esc no longer ends it', () => {
    const props = setup({ leaving: true });
    expect(screen.queryByRole('region', { name: 'Voice mode' })).toBeNull();
    expect(document.querySelector('.voice-dock.is-leaving[inert]')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onEnd).not.toHaveBeenCalled();
  });

  it('beside the open chat, the dock moves aside and drops its Show report button', () => {
    setup({ report: { title: 'R', period: 'P', download: vi.fn() }, besidePanel: true });
    expect(screen.getByRole('region', { name: 'Voice mode' }).className).toContain('is-beside-panel');
    expect(screen.queryByRole('button', { name: 'Show report' })).toBeNull();
  });

  it('an attach draft shows its files and a drop area right in the voice card', () => {
    const file = new File(['x'], 'bug.png', { type: 'image/png' });
    const props = setup({
      draft: { heading: 'Attach files to WEB-5', rows: [['Project', 'WEB'], ['Files', 'bug.png']], status: 'pending' },
      draftFiles: [file],
      onDraftFiles: vi.fn(),
      onDraftRemoveFile: vi.fn(),
    });
    expect(screen.getByRole('list', { name: 'Files ready to attach' }).textContent).toContain('bug.png');
    expect(screen.queryByText('Files')).toBeNull();
    fireEvent.change(screen.getByTestId('assistant-drop-input'), { target: { files: [file] } });
    expect(props.onDraftFiles).toHaveBeenCalled();
  });

  it('lets the user add files by voice dock, shows them, and asks which ticket', () => {
    const file = new File(['x'], 'bug.png', { type: 'image/png' });
    const props = setup({ files: [file], onAddFiles: vi.fn(), onRemoveFile: vi.fn() });
    expect(screen.getByRole('list', { name: 'Files ready to attach' }).textContent).toContain('bug.png');
    expect(screen.getByText('Say which ticket to attach it to.')).toBeTruthy();
    const more = new File(['y'], 'log.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByTestId('assistant-file-input'), { target: { files: [more] } });
    expect(props.onAddFiles).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove bug.png' }));
    expect(props.onRemoveFile).toHaveBeenCalledWith(file);
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(cb, 16));
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows the phase, what was heard and the reply', () => {
    setup({ phase: 'speaking', heard: 'what is overdue', reply: 'Two tickets are overdue.' });
    expect(screen.getByRole('status').textContent).toBe('Speaking· speak or tap the orb to interrupt');
    expect(screen.getByText('“what is overdue”')).toBeTruthy();
    expect(screen.getByText('Two tickets are overdue.')).toBeTruthy();
  });

  it('previews a waiting draft with its details, and can confirm, cancel or open it in the chat', () => {
    const props = setup({
      draft: {
        heading: 'New ticket in TES4',
        rows: [['Title', 'Voice test'], ['Where', 'Chats › Inbox'], ['Severity', 'Minor'], ['Details', 'Checking the assistant works']],
        status: 'pending',
      },
    });
    const preview = screen.getByRole('group', { name: 'Draft: New ticket in TES4' });
    expect(preview.textContent).toContain('Chats › Inbox');
    expect(preview.textContent).toContain('Checking the assistant works');
    expect(preview.textContent).toMatch(/say “confirm” or “cancel”/);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit in chat' }));
    expect(props.onConfirmDraft).toHaveBeenCalledTimes(1);
    expect(props.onCancelDraft).toHaveBeenCalledTimes(1);
    expect(props.onEditDraft).toHaveBeenCalledTimes(1);
  });

  it('a draft being applied, or not yet valid, cannot be confirmed again', () => {
    setup({ draft: { heading: 'Move WEB-5', rows: [], status: 'busy' } });
    expect(screen.getByRole('button', { name: 'Working…' }).disabled).toBe(true);
  });

  it('ends on the End button or Esc, and can hand over to the chat', () => {
    const props = setup();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'End voice mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'End voice mode' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onEnd).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Show chat' }));
    expect(props.onShowChat).toHaveBeenCalledTimes(1);
  });

  it('the orb follows the mic while listening and rests while thinking', () => {
    const micLevel = { current: 0.2 };
    setup({ micLevel });
    const orb = document.querySelector('.voice-orb');
    act(() => { vi.advanceTimersByTime(400); });
    expect(Number(orb.style.getPropertyValue('--vm-level'))).toBeGreaterThan(0.5);
  });

  it('ignores the mic while the assistant is thinking', () => {
    setup({ phase: 'thinking', micLevel: { current: 0.3 } });
    const orb = document.querySelector('.voice-orb');
    act(() => { vi.advanceTimersByTime(400); });
    expect(Number(orb.style.getPropertyValue('--vm-level'))).toBe(0);
  });

  it('useLevelVar eases a live level into a CSS variable, and rests at 0 when inactive', () => {
    const element = document.createElement('button');
    const level = { current: 0.25 };
    const { rerender } = renderHook(({ active }) => {
      const ref = useRef(element);
      useLevelVar(ref, '--mic-level', () => level.current, active);
    }, { initialProps: { active: true } });
    act(() => { vi.advanceTimersByTime(400); });
    expect(Number(element.style.getPropertyValue('--mic-level'))).toBeGreaterThan(0.5);
    rerender({ active: false });
    expect(element.style.getPropertyValue('--mic-level')).toBe('0');
  });

  it('the orb interrupts while the assistant thinks or speaks, and only then', () => {
    const speaking = setup({ phase: 'speaking' });
    const orb = screen.getByRole('button', { name: 'Interrupt the assistant' });
    expect(orb.disabled).toBe(false);
    fireEvent.click(orb);
    expect(speaking.onInterrupt).toHaveBeenCalledTimes(1);
  });

  it('while listening there is nothing to interrupt', () => {
    setup({ phase: 'listening' });
    expect(screen.getByRole('button', { name: 'Interrupt the assistant' }).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Listening');
  });
});
