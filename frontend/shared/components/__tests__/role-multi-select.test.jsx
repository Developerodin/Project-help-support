import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RoleMultiSelect from '../role-multi-select.jsx';

const options = ['admin', 'developer', 'tester'];

function renderInScroller(rect) {
  const view = render(
    <div className="tablewrap" style={{ overflow: 'auto' }} data-testid="scroller">
      <RoleMultiSelect value={['tester']} options={options} onChange={vi.fn()} ariaLabel="Roles" />
    </div>,
  );
  const root = view.container.querySelector('.role-multi-select');
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
    left: 100, width: 200, top: rect.top, bottom: rect.bottom,
  });
  return view;
}

describe('RoleMultiSelect', () => {
  it('renders the panel outside the clipping scroll container', async () => {
    const { container } = renderInScroller({ top: 100, bottom: 130 });
    await userEvent.click(screen.getByRole('button', { name: 'Roles' }));

    const panel = document.querySelector('.role-multi-select__panel');
    expect(panel).toBeTruthy();
    expect(container.querySelector('.role-multi-select__panel')).toBeNull();
    expect(panel.parentElement).toBe(document.body);
    expect(panel.style.top).toBe('134px');
  });

  it('flips above the trigger when there is no room below', async () => {
    window.innerHeight = 400;
    renderInScroller({ top: 330, bottom: 360 });
    await userEvent.click(screen.getByRole('button', { name: 'Roles' }));

    const panel = document.querySelector('.role-multi-select__panel');
    expect(panel.style.top).toBe('');
    expect(panel.style.bottom).toBe('74px');
  });
});
