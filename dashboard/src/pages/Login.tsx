import { useSearchParams } from 'react-router';

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "You're not authorized \u2014 ask an admin to invite you",
  blocked: 'Your access has been blocked',
};

export function Login() {
  const [params] = useSearchParams();
  const error = params.get('error');
  const message = error ? (ERROR_MESSAGES[error] ?? 'An error occurred') : null;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <h1 className="font-heading text-4xl text-text-primary mb-10">Podders</h1>
        <a
          href="/api/v1/auth/discord"
          className="inline-block px-8 py-3 bg-accent text-white rounded-lg font-body text-sm hover:opacity-90 transition-opacity"
        >
          Sign in with Discord
        </a>
        {message && <p className="mt-6 text-accent-red text-sm font-body">{message}</p>}
      </div>
    </div>
  );
}
