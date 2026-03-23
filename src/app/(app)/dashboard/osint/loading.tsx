export default function OSINTLoading() {
  return (
    <div className="flex flex-col gap-6 p-6 animate-pulse">
      <div className="h-12 w-96 rounded-lg bg-card/50" />
      <div className="h-8 w-full rounded-lg bg-card/50" />
      <div className="h-32 rounded-xl bg-card/50" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="h-48 rounded-xl bg-card/50" />
        ))}
      </div>
    </div>
  );
}
