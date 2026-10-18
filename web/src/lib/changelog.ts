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
