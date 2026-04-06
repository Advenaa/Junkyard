import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolUsageIndicator } from '../ToolUsageIndicator';

describe('ToolUsageIndicator', () => {
  it('shows report-aware semantic search copy when report mode is used', () => {
    render(<ToolUsageIndicator tools={['semantic_search:report']} collapsed={false} />);

    expect(screen.getByText('Searched reports by meaning')).toBeInTheDocument();
  });

  it('keeps summary copy for summary mode labels', () => {
    render(<ToolUsageIndicator tools={['semantic_search:summary']} collapsed={false} />);

    expect(screen.getByText('Searched summaries by meaning')).toBeInTheDocument();
  });
});
