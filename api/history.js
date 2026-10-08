import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
    const { method, query, body } = req;
    const sessionId = query.sessionId || (body && body.sessionId);

    if (!sessionId) {
        return res.status(400).json({ reply: 'ข้อผิดพลาด: ไม่พบ Session ID' });
    }

    if (method === 'GET') {
        try {
            const history = await redis.get(`chat:${sessionId}`) || [];
            return res.status(200).json({ history });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (method === 'DELETE') {
        try {
            await redis.del(`chat:${sessionId}`);
            return res.status(200).json({ success: true, message: 'ลบประวัติเรียบร้อย' });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    if (method === 'POST') {
        try {
            const { message, systemInstruction, model } = req.body;
            
            // ดึง Key ของ NVIDIA จาก Vercel Env
            const apiKey = process.env.NVIDIA_API_KEY; 

            if (!apiKey) return res.status(500).json({ reply: 'ไม่พบ NVIDIA_API_KEY ใน Vercel' });

            let history = await redis.get(`chat:${sessionId}`) || [];

            const messages = [];
            
            // 1. ใส่ System Prompt
            if (systemInstruction) {
                messages.push({ role: "system", content: systemInstruction });
            }

            // 2. แปลงประวัติแชท (รองรับทั้งแบบเก่าของ Google และแบบใหม่ของ NVIDIA)
            history.forEach(msg => {
                const text = msg.parts ? msg.parts[0].text : msg.content;
                const role = (msg.role === "model" || msg.role === "assistant") ? "assistant" : "user";
                if (text) messages.push({ role: role, content: text });
            });
            
            // 3. ใส่คำถามใหม่
            messages.push({ role: "user", content: message });

            // ใช้โมเดลที่ผู้ใช้เลือก หรือค่าเริ่มต้น
            const modelName = model || 'meta/llama-3.1-70b-instruct';

            // ยิง API ไปที่ NVIDIA
            const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: modelName,
                    messages: messages,
                    temperature: 1,
                    top_p: 1,
                    max_tokens: 4096,
                    stream: false
                })
            });

            const data = await response.json();

            if (!response.ok || data.error) {
                return res.status(500).json({ reply: `NVIDIA API Error: ${data.error?.message || 'Unknown Error'}` });
            }

            // ดึงคำตอบในรูปแบบโครงสร้าง OpenAI
            if (data.choices && data.choices[0] && data.choices[0].message) {
                const reply = data.choices[0].message.content;
                
                // บันทึกความจำลง Cloud ในโครงสร้างใหม่
                history.push({ role: "user", content: message });
                history.push({ role: "assistant", content: reply });
                
                await redis.set(`chat:${sessionId}`, history);

                return res.status(200).json({ reply });
            } else {
                return res.status(500).json({ reply: 'โครงสร้างข้อมูลจาก NVIDIA ไม่ถูกต้อง' });
            }

        } catch (error) {
            return res.status(500).json({ reply: `Server Error: ${error.message}` });
        }
    }

    return res.status(405).json({ reply: 'Method not allowed' });
}
