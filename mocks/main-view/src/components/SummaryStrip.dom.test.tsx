import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SummaryStrip } from './SummaryStrip';

// DOM smoke test — proves jsdom env + testing-library + the store
// rehydration are all wired. Phase 2 expands this into per-UC
// integration tests under the same harness.

describe('SummaryStrip smoke', () => {
  it('renders all four KPI labels', () => {
    render(<SummaryStrip />);
    expect(screen.getByText(/today's net worth/i)).toBeInTheDocument();
    expect(screen.getByText(/lifetime taxes/i)).toBeInTheDocument();
    expect(screen.getByText(/worst-case ruin/i)).toBeInTheDocument();
    // "Net worth at age <horizon>" — match the prefix.
    expect(screen.getByText(/net worth at age/i)).toBeInTheDocument();
  });
});
