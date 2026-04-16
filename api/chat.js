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
    const { type, message, history, action, option, content } = req.body;

    // ── Regular Chat Mode ──
    if (type === "chat" || !type) {
      const messages = (history || []).concat({ role: "user", content: message });

      const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`
        },
        body: JSON.stringify({
          model: "mistral-small-latest",
          messages
        })
      });

      const json = await r.json();
      const reply = json.choices?.[0]?.message?.content || "No reply";
      
      return res.status(200).json({ reply });
    }

    // ── AI Notes Transform Mode ──
    if (type === "transform") {
      const transformPrompt = buildTransformPrompt(action, option, content);
      
      const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`
        },
        body: JSON.stringify({
          model: "mistral-small-latest",
          messages: [{ role: "user", content: transformPrompt }]
        })
      });

      const json = await r.json();
      const result = json.choices?.[0]?.message?.content || "Transform failed";
      
      return res.status(200).json({ result });
    }

    return res.status(400).json({ error: "Invalid request type" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error: " + err.message });
  }
};

/**
 * Build precise prompts for each AI Notes transformation
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
