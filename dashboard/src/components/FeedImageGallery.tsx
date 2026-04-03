import { useState } from 'react';
import { isSafeUrl } from '../lib/url';

export function FeedImageGallery({ urls }: { urls: string[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const safeUrls = urls.filter(isSafeUrl);

  return (
    <>
      <div className="flex gap-2 flex-wrap">
        {safeUrls.map((url) => (
          <button key={url} onClick={() => setExpanded(url)} className="block rounded overflow-hidden border border-border hover:border-accent transition-colors">
            <img src={url} alt="" className="w-20 h-20 object-cover" loading="lazy" />
          </button>
        ))}
      </div>
      {expanded && isSafeUrl(expanded) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90" onClick={() => setExpanded(null)}>
          <img src={expanded} alt="" className="max-w-[90vw] max-h-[90vh] rounded-lg" />
        </div>
      )}
    </>
  );
}
