export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Only POST allowed" });
    }

    const { message, history } = req.body;

    const messages = [
        { role: "system", content: "You are a helpful study assistant." },
        ...(history || []),
        { role: "user", content: message }
    ];

    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "mistral-small-latest",
            messages: messages
        })
    });

    const data = await response.json();

    res.json({
        reply: data.choices?.[0]?.message?.content || "Error"
    });
}
