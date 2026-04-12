import { useParams } from 'react-router';

export function EntityDetail() {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="py-8 px-4 font-body">
      <h1 className="text-xl font-bold text-text-primary mb-2">Entity Detail</h1>
      <p className="text-text-secondary text-sm">
        Entity <span className="font-mono text-accent">{id}</span> - detail page coming soon.
      </p>
    </div>
  );
}
