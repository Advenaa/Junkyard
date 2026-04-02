import { ReactNode } from 'react';

interface ChatPanelProps {
  children: ReactNode;
}

export function ChatPanel({ children }: ChatPanelProps) {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-6" style={{ maxHeight: 'calc(100vh - 120px)' }}>
      {children}
    </div>
  );
}
