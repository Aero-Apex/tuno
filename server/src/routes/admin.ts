import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth.js';
import { badRequest } from '../http.js';
import { createUser, deleteUser, listUsers, quotaFromGb, updateUser } from '../services/users.js';

/** Account management, for the admin only (Settings → Users). */
export default async function adminRoutes(app: FastifyInstance) {
  app.get('/api/admin/users', async (req) => {
    requireAdmin(req);
    return listUsers();
  });

  app.post('/api/admin/users', async (req) => {
    requireAdmin(req);
    const b = (req.body ?? {}) as { name?: string; password?: string; quotaGb?: number; isAdmin?: boolean };
    return createUser({ name: String(b.name ?? ''), password: b.password as string, quotaBytes: quotaFromGb(b.quotaGb), isAdmin: !!b.isAdmin });
  });

  app.patch('/api/admin/users/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = Number((req.params as { id: string }).id);
    const b = (req.body ?? {}) as { name?: string; password?: string; quotaGb?: number; isAdmin?: boolean };
    if (id === admin.id && b.isAdmin === false) throw badRequest("You can't remove your own admin rights");
    return updateUser(id, {
      name: b.name,
      password: b.password || undefined,
      quotaBytes: b.quotaGb !== undefined ? quotaFromGb(b.quotaGb) : undefined,
      isAdmin: b.isAdmin,
    });
  });

  app.delete('/api/admin/users/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = Number((req.params as { id: string }).id);
    if (id === admin.id) throw badRequest("You can't delete your own account");
    return deleteUser(id);
  });
}
