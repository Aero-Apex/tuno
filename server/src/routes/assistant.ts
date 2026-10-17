import type { FastifyInstance } from 'fastify';
import { currentUser } from '../auth.js';
import { badRequest } from '../http.js';
import { approveAction, chat, rejectAction } from '../services/assistant.js';

/** The in-app assistant (see services/assistant.ts). */
export default async function assistantRoutes(app: FastifyInstance) {
  app.post('/api/assistant/chat', async (req) => {
    const user = currentUser(req);
    const body = (req.body ?? {}) as { messages?: unknown };
    if (!Array.isArray(body.messages)) throw badRequest('Send the conversation as a list of messages');
    const history = body.messages
      .slice(-30)
      .map((m) => ({
        role: (m as { role?: unknown })?.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: String((m as { content?: unknown })?.content ?? '').slice(0, 4000),
      }))
      .filter((m) => m.content.trim());
    if (!history.length || history[history.length - 1].role !== 'user') throw badRequest('Say something first');
    return chat(user.id, history);
  });

  app.post('/api/assistant/actions/:id/approve', async (req) => approveAction(currentUser(req).id, (req.params as { id: string }).id));

  app.post('/api/assistant/actions/:id/reject', async (req) => rejectAction(currentUser(req).id, (req.params as { id: string }).id));
}
