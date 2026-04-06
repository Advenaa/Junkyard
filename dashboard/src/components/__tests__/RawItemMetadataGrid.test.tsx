import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RawItemMetadataGrid } from '../RawItemMetadataGrid';

describe('RawItemMetadataGrid', () => {
  it('renders source, capture time, and language/filter flags', () => {
    render(
      <RawItemMetadataGrid
        sourceId="guild:1234"
        createdAtLabel="2026-04-06 08:01 UTC"
        translated
        originalLanguage="eng"
        filterReason="spam"
      />,
    );

    expect(screen.getByText('guild:1234')).toBeInTheDocument();
    expect(screen.getByText('2026-04-06 08:01 UTC')).toBeInTheDocument();
    expect(screen.getByText('Translated to English | language eng | filter spam')).toBeInTheDocument();
  });

  it('renders the original-text flag when no translation metadata is present', () => {
    render(
      <RawItemMetadataGrid
        sourceId="guild:1234"
        createdAtLabel="2026-04-06 08:01 UTC"
        translated={false}
        originalLanguage={null}
        filterReason={null}
      />,
    );

    expect(screen.getByText('Original text kept')).toBeInTheDocument();
  });
});
