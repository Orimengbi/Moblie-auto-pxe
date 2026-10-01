export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="mb-6 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    </header>
  );
}
