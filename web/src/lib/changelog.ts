export interface ChangeItem {
  title: string;
  text?: string;
}

export interface ChangeSection {
  heading: string;
  items: ChangeItem[];
}

export interface ChangeEntry {
  title: string;
  sections: ChangeSection[];
}

/** What changed in each release, shown once after an update. Keep it in step with the release notes. */
export const CHANGELOG: Record<string, ChangeEntry> = {
  '1.2.1': {
    title: 'A new desktop app',
    sections: [
      {
        heading: 'Changed',
        items: [
          {
            title: 'Rebuilt from the ground up',
            text: 'The Windows and Mac apps are now one small program written in Rust. Each download is under 1 MB, and Windows no longer needs .NET.',
          },
          {
            title: 'Setup inside the window',
            text: 'Choosing where your music lives and entering your server now happens right here, in the same dark style as Tuno. Switching between this PC and a server no longer restarts the app.',
          },
          {
            title: 'Sharp on every screen',
            text: 'On Windows, Tuno stays crisp when you move it between monitors with different scaling.',
          },
        ],
      },
    ],
  },
  '1.2.0': {
    title: 'Autoplay',
    sections: [
      {
        heading: 'New',
        items: [
          {
            title: 'Autoplay',
            text: 'When your playlist or queue ends, Tuno keeps playing more songs from your library, starting with the artists you were listening to. Turn it off in Settings → Playback.',
          },
        ],
      },
      {
        heading: 'Fixed',
        items: [
          {
            title: 'Music no longer stops after a few songs fail',
            text: 'Songs that can\'t be played (for example when YouTube asks to confirm you\'re not a bot) are skipped, and the queue keeps going.',
          },
        ],
      },
    ],
  },
  '1.1.6': {
    title: 'Tuno on this PC, and Discord',
    sections: [
      {
        heading: 'New',
        items: [
          {
            title: 'Run Tuno on this PC',
            text: 'No server needed. Songs download to this PC and stay private. Pick it at first start, or from the Tuno menu.',
          },
          {
            title: 'Listening on Discord',
            text: 'Your Discord profile shows what you are listening to, with the song and its progress, like Spotify. Discord must be open on this PC. Turn it off in This PC.',
          },
          {
            title: 'This PC settings',
            text: 'Settings → This PC shows where your music lives, and the Discord switch.',
          },
          {
            title: 'What is new',
            text: 'After an update, Tuno shows what changed.',
          },
        ],
      },
      {
        heading: 'Changed',
        items: [
          {
            title: 'Your library stays on one PC',
            text: 'The on-PC library opens only on the PC it was made on. A copied folder won\'t open elsewhere.',
          },
          {
            title: 'No log out on this PC',
            text: 'Signing in is automatic on this PC, so Log out isn\'t shown.',
          },
        ],
      },
    ],
  },
};
