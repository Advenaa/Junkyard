export function TldrBlock({ text }: { text: string }) {
  return (
    <blockquote className="border-l-4 border-accent pl-4 py-2">
      <p className="font-heading text-xl text-text-primary leading-relaxed">{text}</p>
    </blockquote>
  );
}
