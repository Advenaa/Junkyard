export interface User {
  discordId: string;
  username: string;
  avatar: string | null;
  role: 'admin' | 'viewer' | 'blocked';
}

export interface Report {
  id: string;
  date: string;
  type: 'daily' | 'flash' | 'pulse';
  tldr: string;
  sentiment: number | null;
  deliveryStatus: string;
  createdAt: number;
}
