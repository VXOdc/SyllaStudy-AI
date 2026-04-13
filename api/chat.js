export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Use POST" });
    }

    const { message } = req.body;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: "You are a helpful student assistant inside a study app."
                },
                {
                    role: "user",
                    content: message
                }
            ]
        })
    });

    const data = await response.json();

    res.status(200).json({
        reply: data.choices?.[0]?.message?.content || "Error"
    });
}
