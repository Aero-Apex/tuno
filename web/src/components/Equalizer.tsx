/** Little animated bars shown next to the song that's playing. */
export function Equalizer({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex h-3.5 w-3.5 items-end justify-between ${className}`} aria-label="Playing">
      {[0, 0.25, 0.5].map((d) => (
        <span key={d} className="w-[3px] animate-eq rounded-sm bg-accent" style={{ animationDelay: `${d}s` }} />
      ))}
    </span>
  );
}
