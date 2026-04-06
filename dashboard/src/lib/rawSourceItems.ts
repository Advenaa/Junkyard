import { normalizeRawMessageAttachments } from './rawMessages';

export interface RawSourceItemResponse {
  id: string;
  source: string;
  sourceId: string;
  author: string;
  content: string;
  timestamp: number;
  url: string | null;
  engagement: number | Record<string, number> | null;
  attachments: string[] | string | null;
  originalLanguage: string | null;
  translated: boolean;
  filterReason: string | null;
  status: string;
  createdAt: number;
}

export interface RawSourceItem extends Omit<RawSourceItemResponse, 'attachments'> {
  attachments: string[];
}

export interface RawSourceItemContextResponse {
  item: RawSourceItemResponse;
  context?: {
    older: RawSourceItemResponse[];
    newer: RawSourceItemResponse[];
  };
}

export function normalizeRawSourceItem(raw: RawSourceItemResponse): RawSourceItem {
  return { ...raw, attachments: normalizeRawMessageAttachments(raw.attachments) };
}
