/**
 * Account setup from the command line (for creating the first admin). Reads one JSON command from stdin
 * so passwords never end up in shell history or process lists:
 *
 *   echo '{"action":"add-user","name":"Owner","password":"…","quotaGb":100,"admin":true}' | docker exec -i tuno node server/dist/cli.js
 *   echo '{"action":"list-users"}' | docker exec -i tuno node server/dist/cli.js
 */
import { backfillSizes } from './services/library.js';
import { createUser, listUsers, quotaFromGb } from './services/users.js';

const input = await new Promise<string>((resolve) => {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (data += c));
  process.stdin.on('end', () => resolve(data));
});

const cmd = JSON.parse(input || '{}') as { action?: string; name?: string; password?: string; quotaGb?: number; admin?: boolean };
const GB = 1024 ** 3;

try {
  if (cmd.action === 'add-user') {
    backfillSizes();
    const u = createUser({ name: cmd.name ?? 'Account', password: cmd.password ?? '', quotaBytes: quotaFromGb(cmd.quotaGb), isAdmin: !!cmd.admin });
    console.log(`Created "${u.name}" (id ${u.id}, ${u.quotaBytes / GB} GB${u.isAdmin ? ', admin' : ''})`);
  } else if (cmd.action === 'list-users') {
    for (const u of listUsers()) {
      console.log(`${u.id}\t${u.name}\t${(u.usedBytes / GB).toFixed(2)} / ${u.quotaBytes / GB} GB\t${u.songs} songs${u.isAdmin ? '\tadmin' : ''}`);
    }
  } else {
    console.error('Unknown action. Use add-user or list-users.');
    process.exitCode = 1;
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
}
process.exit();
