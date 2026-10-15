import { Music2 } from 'lucide-react';
import { useState } from 'react';
import { img } from '../lib/img';

interface Props {
  src?: string | null;
  /** Up to four covers shown as a 2×2 mosaic when there's no main cover. */
  mosaic?: string[];
  className?: string;
  alt?: string;
  round?: boolean;
}

export function Cover({ src, mosaic, className = '', alt = '', round }: Props) {
  const [failed, setFailed] = useState(false);
  const shape = round ? 'rounded-full' : 'cover';
  const url = img(src);

  if (url && !failed) {
    return (
      <img
        src={url}
        alt={alt}
        loading="lazy"
        draggable={false}
        onError={() => setFailed(true)}
        className={`${shape} aspect-square bg-elevated object-cover shadow-md ${className}`}
      />
    );
  }
  if (mosaic && mosaic.length >= 4) {
    return (
      <div className={`${shape} grid aspect-square grid-cols-2 overflow-hidden bg-elevated shadow-md ${className}`}>
        {mosaic.slice(0, 4).map((m) => (
          <img key={m} src={m} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
        ))}
      </div>
    );
  }
  if (mosaic && mosaic.length) return <Cover src={mosaic[0]} className={className} alt={alt} round={round} />;
  return (
    <div className={`${shape} flex aspect-square items-center justify-center bg-elevated text-muted shadow-md ${className}`}>
      <Music2 className="h-1/3 w-1/3" strokeWidth={1.5} />
    </div>
  );
}
