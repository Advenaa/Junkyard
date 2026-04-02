export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="text-center py-16">
      <p className="text-text-secondary text-lg">{title}</p>
      {description && <p className="text-text-secondary/60 mt-2 text-sm">{description}</p>}
    </div>
  );
}
