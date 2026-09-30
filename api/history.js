import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv(); 

export default async function handler(req, res) {
    const { method, query, body } = req;
    const sessionId = query.sessionId || (body && body.sessionId);

    if (!sessionId) {
        return res.status(400).json({ error: 'ไม่พบ Session ID' });
    }

    // โหลดประวัติจาก Cloud
    if (method === 'GET') {
        try {
            const history = await redis.get(`chat:${sessionId}`) || [];
            return res.status(200).json({ history });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    // เซฟประวัติทับลง Cloud
    if (method === 'POST') {
        try {
            await redis.set(`chat:${sessionId}`, body.history);
            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    // ล้างประวัติใน Cloud
    if (method === 'DELETE') {
        try {
            await redis.del(`chat:${sessionId}`);
            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
