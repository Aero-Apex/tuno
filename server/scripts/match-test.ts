// Quick manual check of Spotify → upload matching: npx tsx scripts/match-test.ts
import { matchSong } from '../src/services/search.js';

const cases: [string, string, number][] = [
  ['Trillium - Slowed', 'Elliot Sutton', 77.7],
  ['Get Lucky (feat. Pharrell Williams and Nile Rodgers)', 'Daft Punk, Pharrell Williams, Nile Rodgers', 369.6],
  ['Blinding Lights', 'The Weeknd', 200],
  ['MONTAGEM ALQUIMIA - SUPER SLOWED', 'h6itam, n7san7os, Mc Menor Do Alvorada', 120],
  ['Bohemian Rhapsody - Remastered 2011', 'Queen', 354],
  ['Stop The Wedding!', 'Ashe', 198.8],
];
for (const [title, artist, dur] of cases) {
  const t = Date.now();
  const m = await matchSong(title, artist, dur);
  console.log(`${(Date.now() - t).toString().padStart(5)}ms  ${artist} - ${title}\n         -> ${m ? `${m.score.toFixed(2)} [${m.source}] ${m.title}` : 'NO MATCH'}`);
}
process.exit(0);
