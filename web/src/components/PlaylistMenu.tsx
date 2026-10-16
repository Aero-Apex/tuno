import { ListX, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useActions } from '../lib/actions';
import { Menu, useMenu } from './Menu';

export interface PlaylistRef {
  id: number;
  name: string;
  count: number;
}

/** Right-click menu for a playlist wherever one is listed: delete it, or delete the songs that aren't in it. */
export function usePlaylistMenu() {
  const actions = useActions();
  const menu = useMenu();
  const [target, setTarget] = useState<PlaylistRef | null>(null);
  return {
    onContextMenu: (p: PlaylistRef) => (e: React.MouseEvent) => {
      setTarget(p);
      menu.open(e);
    },
    element: target ? (
      <Menu
        {...menu.props([
          { label: 'Delete playlist', icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => actions.deletePlaylist(target) },
          { label: '', divider: true },
          { label: 'Delete other songs', icon: <ListX className="h-4 w-4" />, danger: true, onClick: () => actions.deleteOtherSongs(target) },
        ])}
      />
    ) : null,
  };
}
