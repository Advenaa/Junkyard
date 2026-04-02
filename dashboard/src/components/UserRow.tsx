import { RoleBadge } from './RoleBadge';

interface User {
  discordId: string;
  username: string;
  avatar: string | null;
  role: string;
}

const ROLES = ['admin', 'viewer', 'blocked'];

export function UserRow({ user }: { user: User }) {
  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png?size=64`
    : `https://cdn.discordapp.com/embed/avatars/${Number(user.discordId) % 5}.png`;

  return (
    <tr className="border-b border-border hover:bg-surface-raised/50 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <img src={avatarUrl} alt="" className="w-8 h-8 rounded-full" />
          <span className="text-text-primary text-sm">{user.username}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <RoleBadge role={user.role} />
      </td>
      <td className="px-4 py-3">
        <select
          defaultValue={user.role}
          className="bg-surface-raised border border-border rounded px-2 py-1 text-text-secondary text-xs font-mono focus:outline-none focus:border-accent"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </td>
    </tr>
  );
}
