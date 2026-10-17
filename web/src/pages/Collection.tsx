import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { ActionBar, GradientHeader, PageBar } from '../components/Page';
import { contextSlice, usePlayer } from '../store/player';
import { TrackList } from '../components/TrackList';
import { api } from '../lib/api';
import { useCoverColor } from '../lib/color';
import { fmtLong, plural } from '../lib/format';
import { FilterInput, PlayAllBar } from './Library';

function CollectionPage({ kind }: { kind: 'album' | 'artist' }) {
  const name = decodeURIComponent(useParams().name ?? '');
  const { data: tracks = [] } = useQuery({
    queryKey: ['tracks', kind, name],
    queryFn: () => api.tracks(kind === 'album' ? { album: name, sort: 'title' } : { artist: name, sort: 'plays' }),
  });
  const [q, setQ] = useState('');
  const cover = tracks.find((t) => t.cover)?.cover;
  const tint = useCoverColor(cover);
  const filtered = q ? tracks.filter((t) => `${t.title} ${t.album ?? ''}`.toLowerCase().includes(q.toLowerCase())) : tracks;
  const ctx = `${kind}:${name}`;
  const artists = [...new Set(tracks.map((t) => t.artist))];
  const { context, playing, toggle, playTracks } = usePlayer(useShallow(contextSlice));

  return (
    <div className="animate-fade-in pb-10">
      <PageBar title={name} playing={context === ctx && playing} onPlay={() => (context === ctx ? toggle() : filtered.length && playTracks(filtered, 0, ctx))} />
      <GradientHeader
        cover={cover}
        round={kind === 'artist'}
        kicker={kind === 'album' ? 'Album' : 'Artist'}
        title={name}
        meta={
          <>
            {kind === 'album' && artists.length > 0 && <span className="font-bold">{artists.slice(0, 3).join(', ')} •</span>}
            <span className="text-text/70">
              {plural(tracks.length, 'song')}, {fmtLong(tracks.reduce((a, t) => a + (t.duration ?? 0), 0))}
            </span>
          </>
        }
      />
      <ActionBar tint={tint}>
        <PlayAllBar tracks={filtered} context={ctx} />
        <div className="ml-auto max-md:hidden">
          <FilterInput value={q} onChange={setQ} placeholder={kind === 'album' ? 'Search in album' : 'Search in songs'} />
        </div>
      </ActionBar>
      <div className="relative px-2 md:px-4">
        <TrackList tracks={filtered} context={ctx} showAlbum={kind === 'artist'} showAdded={false} />
      </div>
    </div>
  );
}

export const AlbumPage = () => <CollectionPage kind="album" />;
export const ArtistPage = () => <CollectionPage kind="artist" />;
