import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminStatsDTO } from '../../api/types';
import { caseStore } from '../../state/caseStore';
import { signInAs } from '../../test/auth';
import { fakeAdminServer, ME_ADMIN, statsFixture } from '../../test/fakeAdminServer';
import { FUTURE } from '../../test/router';
import { AppRoutes } from '../AppRoutes';
import { niceAxis, normalizeDays, shortDay, TOOLTIP_H } from './chartMath';

/** Synthetic stats: 30 zero-filled days ending 2026-09-25 with 3 busy days. */
const STATS: AdminStatsDTO = statsFixture(
  '2026-09-25',
  { '2026-09-01': 2, '2026-09-20': 5, '2026-09-25': 1 },
  {
    cases_total: 8,
    // Keys deliberately NOT in form order (JSONB): tiles must read them by name.
    cases_by_status: { finalized: 3, draft: 5 },
    documents_total: 12345,
    per_user: [
      {
        user_id: 'u-1',
        username: 'wf-ana',
        full_name: 'Dra. Ana Sintetica',
        drafts: 4,
        finalized: 3,
        last_activity: '2026-09-25T12:00:00Z',
      },
      { user_id: 'u-2', username: 'wf-beto', full_name: '', drafts: 1, finalized: 0, last_activity: null },
    ],
  },
);

function setup(stats: AdminStatsDTO | undefined, override?: () => Response) {
  const server = fakeAdminServer({ me: ME_ADMIN(), stats });
  if (override) server.override('GET /admin/stats', override);
  vi.stubGlobal('fetch', server.fetch);
  caseStore.getState().reset();
  signInAs(ME_ADMIN());
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/admin']} future={FUTURE}>
      <AppRoutes />
    </MemoryRouter>,
  );
  return { server, user };
}

afterEach(() => vi.unstubAllGlobals());

describe('Admin dashboard', () => {
  it('renders the stat tiles from the fixture (status counts read by key, not order)', async () => {
    setup(STATS);
    const tiles = await screen.findByRole('list', { name: 'Totals' });
    const items = within(tiles)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items).toEqual(['Cases8', 'Drafts5', 'Finalized3', 'Documents12.3K']);
  });

  it('draws one column per non-zero day and keeps zero-filled days in the table view', async () => {
    setup(STATS);
    await screen.findByRole('list', { name: 'Totals' });
    const bars = screen.getAllByTestId('chart-bar');
    expect(bars.map((b) => b.getAttribute('data-date'))).toEqual(['2026-09-01', '2026-09-20', '2026-09-25']);
    // Accessible summary.
    const svg = screen.getByRole('img', { name: /Cases per day/ });
    expect(svg).toHaveAccessibleName('Cases per day 8 cases from Aug 27 to Sep 25; busiest day Sep 20 with 5 cases.');
    // The table view carries all 30 days, zero days included, in date order.
    const table = screen.getByRole('table', { name: 'Cases per day (UTC)' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(30);
    expect(rows[0]).toHaveTextContent('Thu, Aug 27, 2026' + '0');
    expect(rows[5]).toHaveTextContent('Tue, Sep 1, 2026' + '2');
    expect(rows[29]).toHaveTextContent('Fri, Sep 25, 2026' + '1');
    expect(rows.filter((r) => r.textContent?.endsWith('0'))).toHaveLength(27);
    // Peak labelled on its cap; weekly x labels anchored on today.
    expect(screen.getByText('5', { selector: '.chart__value' })).toBeInTheDocument();
    expect(screen.getByText('Sep 25', { selector: '.chart__tick' })).toBeInTheDocument();
    expect(screen.getByText('Sep 18', { selector: '.chart__tick' })).toBeInTheDocument();
  });

  it('hover and keyboard show a tooltip for the day (value first)', async () => {
    const { user } = setup(STATS);
    await screen.findByRole('list', { name: 'Totals' });
    const hits = document.querySelectorAll('.chart__hit');
    expect(hits).toHaveLength(30);
    fireEvent.pointerMove(hits[24]!); // 2026-09-20
    const tip = document.querySelector('.chart__tooltip')!;
    expect(tip).toHaveTextContent('5 casesSun, Sep 20, 2026');
    // The peak day has no room above its cap (the card clips overflow): the tooltip flips below,
    // anchored on the cap, so it is neither cut off nor covering the peak label.
    expect(tip).toHaveClass('chart__tooltip--below');
    expect(tip).toHaveAttribute('data-placement', 'below');
    const peakCapTop = parseFloat((tip as HTMLElement).style.top);
    expect(peakCapTop).toBeGreaterThanOrEqual(0);
    expect(peakCapTop - TOOLTIP_H - 8).toBeLessThan(0);
    // A short bar keeps the tooltip above its cap, fully inside the frame.
    fireEvent.pointerMove(hits[29]!); // 2026-09-25, 1 case
    const low = document.querySelector('.chart__tooltip') as HTMLElement;
    expect(low).not.toHaveClass('chart__tooltip--below');
    expect(low).toHaveAttribute('data-placement', 'above');
    expect(parseFloat(low.style.top) - TOOLTIP_H).toBeGreaterThanOrEqual(0);

    // Keyboard: focus the chart → latest day; ← moves back; announced politely.
    fireEvent.pointerLeave(screen.getByRole('group', { name: 'Cases per day' }));
    const frame = screen.getByRole('group', { name: 'Cases per day' });
    expect(frame).toHaveAttribute('tabindex', '0');
    act(() => frame.focus());
    expect(document.querySelector('.chart__tooltip')).toHaveTextContent('1 caseFri, Sep 25, 2026');
    await user.keyboard('{ArrowLeft}');
    expect(document.querySelector('.chart__tooltip')).toHaveTextContent('0 casesThu, Sep 24, 2026');
    expect(screen.getByText('Thu, Sep 24, 2026: 0 cases')).toBeInTheDocument();
    await user.keyboard('{Home}');
    expect(document.querySelector('.chart__tooltip')).toHaveTextContent('Aug 27, 2026');
  });

  it('per-anesthesiologist table links to the case list filtered by owner', async () => {
    setup(STATS);
    const link = await screen.findByRole('link', { name: /^Dra\. Ana Sintetica\s*— view cases$/ });
    expect(link).toHaveAttribute('href', '/admin/cases?user_id=u-1');
    const row = link.closest('tr')!;
    expect(
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['4', '3', expect.stringMatching(/^2026-09-25 /)]);
    // No full name → the username; no activity → a dash.
    const beto = screen.getByRole('link', { name: /^wf-beto\s*— view cases$/ }).closest('tr')!;
    expect(within(beto).getAllByRole('cell').at(-1)).toHaveTextContent('—');
  });

  it('empty state: no cases and no anesthesiologists', async () => {
    setup(statsFixture('2026-09-25', {}));
    expect(await screen.findByText('No cases in the last 30 days.')).toBeInTheDocument();
    expect(screen.queryAllByTestId('chart-bar')).toHaveLength(0);
    expect(screen.getByText('No anesthesiologists yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/admin/users/new');
  });

  it('loading then error state with Retry', async () => {
    let fail = true;
    const { user } = setup(STATS, () =>
      fail
        ? new Response(JSON.stringify({ detail: 'stats unavailable' }), { status: 500 })
        : new Response(JSON.stringify(STATS), { status: 200 }),
    );
    expect(screen.getByText('Loading dashboard…')).toBeInTheDocument();
    expect(await screen.findByText('Couldn’t load the dashboard')).toBeInTheDocument();
    expect(screen.getByText(/stats unavailable/)).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('list', { name: 'Totals' })).toBeInTheDocument();
  });
});

describe('chart helpers', () => {
  it('normalizeDays sorts by date and zero-fills gaps (never trusts array order)', () => {
    const out = normalizeDays([
      { date: '2026-09-03', count: 1 },
      { date: '2026-09-01', count: 2 },
    ]);
    expect(out).toEqual([
      { date: '2026-09-01', count: 2 },
      { date: '2026-09-02', count: 0 },
      { date: '2026-09-03', count: 1 },
    ]);
    expect(normalizeDays([])).toEqual([]);
  });

  it('niceAxis gives clean integer steps with at most 4 intervals', () => {
    expect(niceAxis(0)).toEqual({ top: 1, step: 1 });
    expect(niceAxis(3)).toEqual({ top: 3, step: 1 });
    expect(niceAxis(5)).toEqual({ top: 6, step: 2 });
    expect(niceAxis(17)).toEqual({ top: 20, step: 5 });
    expect(niceAxis(1234)).toEqual({ top: 1500, step: 500 });
  });

  it('shortDay formats the UTC calendar day in UTC', () => {
    expect(shortDay('2026-09-01')).toBe('Sep 1');
  });
});
