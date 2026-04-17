module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const body = req.body || {};
    let messages = [];
    let isTaskExplosion = false;
    let isTransform = false;

    // 1. Normalize Input (Supports strict "messages" array or legacy payload)
    if (body.messages && Array.isArray(body.messages)) {
      messages = body.messages;
    } else if (body.type === "task_explosion") {
      isTaskExplosion = true;
      if (!body.goal) return res.status(400).json({ error: "Missing goal" });

      const taskPrompt = `You are an elite productivity AI. The user has a single session goal: "${body.goal}".
      Break this goal down into 4-8 highly actionable micro-tasks. 
      Assign a realistic time estimate (in minutes) to each task.
      Assign an energy level requirement for each task: "high", "medium", or "low".
      
      If the user provided context from their notes, use it to make the tasks highly specific:
      [NOTES CONTEXT: ${body.notesContext || "None provided"}]
      
      OUTPUT FORMAT:
      You MUST return ONLY a raw JSON array of objects. Do not include markdown formatting like \`\`\`json. 
      Example:
      [
        {"text": "Review chapter 7 notes", "time": 10, "energy": "low"},
        {"text": "Draft main essay body", "time": 45, "energy": "high"}
      ]`;
      messages = [{ role: "user", content: taskPrompt }];
    } else if (body.type === "transform") {
      isTransform = true;
      if (!body.action || !body.option || !body.content) {
        return res.status(400).json({ error: "Missing action, option, or content" });
      }
      messages = [{ role: "user", content: buildTransformPrompt(body.action, body.option, body.content) }];
    } else {
      messages = (body.history || []).concat({ role: "user", content: body.message || "" });
    }

    // 2. Execute AI requests with fallback
    const aiResponse = await getAIResponseWithFallback(messages);

    if (!aiResponse) {
      return res.status(502).json({ error: "All AI providers failed" });
    }

    // 3. Format Output
    const responsePayload = {
      source: aiResponse.source,
      reply: aiResponse.text
    };

    // Maintain legacy app compatibility
    if (isTaskExplosion) {
      const cleanJsonStr = aiResponse.text.replace(/```json/g, "").replace(/```/g, "").trim();
      try {
        responsePayload.tasks = JSON.parse(cleanJsonStr);
      } catch (e) {
        // Suppress parsing error to prevent crashing; return safe raw reply instead
      }
    } else if (isTransform) {
      responsePayload.result = aiResponse.text;
    }

    return res.status(200).json(responsePayload);

  } catch (err) {
    // Completely sanitized error response (no internal details)
    return res.status(500).json({ error: "All AI providers failed" });
  }
};

/**
 * Orchestrates the Mistral primary and Gemini fallback logic.
 */
async function getAIResponseWithFallback(messages) {
  try {
    const mistralText = await callMistral(messages);
    return { source: "mistral", text: mistralText };
  } catch (mistralErr) {
    console.warn("Mistral failed, switching to Gemini");

    try {
      const geminiText = await callGemini(messages);
      return { source: "gemini", text: geminiText };
    } catch (geminiErr) {
      console.error("Gemini failed");
      return null;
    }
  }
}

/**
 * Primary Provider: Mistral AI (8-second timeout)
 */
async function callMistral(messages) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`
      },
      body: JSON.stringify({
        model: "mistral-small",
        messages: messages
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error("Mistral API non-200 response");
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "No reply";
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fallback Provider: Gemini AI (8-second timeout)
 */
async function callGemini(messages) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const contents = messages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error("Gemini API non-200 response");
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "No reply";
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Generates context prompts for transform tasks
 */
function buildTransformPrompt(action, option, content) {
  const systemContext = `You are an AI notes transformation engine. Your job is to transform note content exactly as requested. Never invent facts. Keep formatting clean and readable. Use Markdown when helpful.`;

  const prompts = {
    summarize: {
      brief: `${systemContext}\n\nSummarize this note into a SHORT, concise summary (2-3 sentences max). Keep only essential ideas.\n\nNote:\n${content}`,
      detailed: `${systemContext}\n\nCreate a DETAILED summary of this note. Keep all important points but organize clearly.\n\nNote:\n${content}`,
      bullets: `${systemContext}\n\nExtract key points from this note as bullet points. Be concise.\n\nNote:\n${content}`
    },
    rewrite: {
      concise: `${systemContext}\n\nRewrite this note to be MORE CONCISE. Remove redundancy and filler. Keep the same meaning.\n\nNote:\n${content}`,
      academic: `${systemContext}\n\nRewrite this note in a MORE ACADEMIC style. Use formal language and structured sentences.\n\nNote:\n${content}`,
      casual: `${systemContext}\n\nRewrite this note in a MORE CASUAL, conversational style. Make it friendly and approachable.\n\nNote:\n${content}`,
      structured: `${systemContext}\n\nRewrite this note with BETTER STRUCTURE. Use clear headings, lists, and logical flow.\n\nNote:\n${content}`
    },
    extract: {
      key_points: `${systemContext}\n\nExtract the KEY POINTS from this note. List each one clearly. No explanations, just the points.\n\nNote:\n${content}`,
      definitions: `${systemContext}\n\nExtract DEFINITIONS or key terms from this note. Format as "Term: Definition".\n\nNote:\n${content}`,
      concepts: `${systemContext}\n\nExtract the main CONCEPTS from this note. List each concept and what it means.\n\nNote:\n${content}`,
      action_items: `${systemContext}\n\nExtract ACTION ITEMS or tasks from this note. List things the user should do. If there are none, say "No action items found".\n\nNote:\n${content}`
    },
    generate: {
      flashcards: `${systemContext}\n\nGenerate FLASHCARDS from this note. Format as:\nQ: Question?\nA: Answer\n\nCreate 5-8 flashcards.\n\nNote:\n${content}`,
      study_questions: `${systemContext}\n\nGenerate STUDY QUESTIONS from this note. Create both basic recall questions and deeper thinking questions. Format:\n- Basic: [question]\n- Deep: [question]\n\nNote:\n${content}`,
      outline: `${systemContext}\n\nCreate a hierarchical OUTLINE from this note. Use proper indentation and structure.\n\nNote:\n${content}`,
      mindmap: `${systemContext}\n\nCreate a TEXT-BASED MIND MAP from this note. Show branches and connections.\n\nNote:\n${content}`,
      study_plan: `${systemContext}\n\nCreate a STUDY PLAN based on this note. Break it into time blocks (Day 1, Day 2, etc.) with specific tasks.\n\nNote:\n${content}`
    },
    explain: {
      simple: `${systemContext}\n\nExplain this note LIKE I'M 5 YEARS OLD. Use simple words, no jargon, use analogies.\n\nNote:\n${content}`,
      intermediate: `${systemContext}\n\nExplain this note LIKE I'M 12 YEARS OLD. Use clear language, some structure, basic depth.\n\nNote:\n${content}`,
      advanced: `${systemContext}\n\nExplain this note LIKE YOU'RE A PROFESSOR. Use technical language, detailed analysis, academic tone.\n\nNote:\n${content}`
    },
    expand: {
      full: `${systemContext}\n\nEXPAND this note. Turn bullet points into full paragraphs. Add transitions and explanations. Keep all original info but make it more readable.\n\nNote:\n${content}`,
      examples: `${systemContext}\n\nEXPAND this note by ADDING EXAMPLES. For each main point, add a concrete example or illustration.\n\nNote:\n${content}`,
      explanations: `${systemContext}\n\nEXPAND this note by ADDING EXPLANATIONS. For each point, explain the "why" and "how".\n\nNote:\n${content}`
    },
    translate: {
      es: `Translate this note to SPANISH. Keep formatting. Only output the translation.\n\nNote:\n${content}`,
      fr: `Translate this note to FRENCH. Keep formatting. Only output the translation.\n\nNote:\n${content}`,
      de: `Translate this note to GERMAN. Keep formatting. Only output the translation.\n\nNote:\n${content}`,
      zh: `Translate this note to CHINESE (Simplified). Keep formatting. Only output the translation.\n\nNote:\n${content}`,
      ja: `Translate this note to JAPANESE. Keep formatting. Only output the translation.\n\nNote:\n${content}`
    }
  };

  return prompts[action]?.[option] || `Transform the following note:\n${content}`;
}
