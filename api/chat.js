/**
 * TaskFlow API Handler
 * Unified backend for task explosion, scheduling, focus recommendations,
 * first-step generation, notes transformation, and general chat.
 *
 * Uses Anthropic Claude (claude-haiku-4-5-20251001 for speed, sonnet for complex tasks).
 * Set ANTHROPIC_API_KEY in your environment.
 */

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL_FAST = "claude-haiku-4-5-20251001";    // fast, cheap — first steps, durations
const MODEL_SMART = "claude-sonnet-4-6";            // deeper reasoning — scheduling, transforms

async function callClaude(model, messages, systemPrompt, maxTokens = 1000) {
  const body = {
    model,
    max_tokens: maxTokens,
    messages
  };
  if (systemPrompt) body.system = systemPrompt;

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data.content?.map(c => c.type === "text" ? c.text : "").join("") || "";
  return text;
}

function stripJson(raw) {
  return raw.replace(/```json/gi, "").replace(/```/g, "").trim();
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const {
      type,
      message,
      history,
      // task explosion
      goal,
      notesContext,
      // focus duration recommendation
      taskText,
      taskTime,
      taskEnergy,
      // first step
      task,
      // notes transform
      action,
      option,
      content
    } = req.body;

    /* ──────────────────────────────────────────────────
       1. TASK EXPLOSION
       Breaks a goal into 4–8 micro-tasks with time + energy
    ────────────────────────────────────────────────── */
    if (type === "task_explosion") {
      if (!goal) return res.status(400).json({ error: "Missing goal" });

      const system = `You are an elite productivity AI. Break goals into highly actionable micro-tasks. 
Never invent facts. Output ONLY raw JSON arrays — no markdown, no prose.`;

      const prompt = `Goal: "${goal}"
${notesContext ? `Notes context: ${notesContext}` : ""}

Break this into 4–8 actionable micro-tasks. Return ONLY a raw JSON array:
[
  {"text": "Task description", "time": 15, "energy": "low"},
  {"text": "Another task", "time": 45, "energy": "high"}
]
Energy must be "high", "medium", or "low". Time is integer minutes.`;

      const raw = await callClaude(MODEL_FAST, [{ role: "user", content: prompt }], system, 1000);
      
      try {
        const tasks = JSON.parse(stripJson(raw));
        return res.status(200).json({ tasks });
      } catch {
        console.error("Failed to parse task explosion:", raw);
        return res.status(500).json({ error: "AI returned invalid task structure." });
      }
    }

    /* ──────────────────────────────────────────────────
       2. AI DURATION RECOMMENDATION
       Recommends ideal focus session length for a task
    ────────────────────────────────────────────────── */
    if (type === "duration_recommendation") {
      if (!taskText) return res.status(400).json({ error: "Missing taskText" });

      const system = `You are a focus and productivity coach. Recommend ideal focus session durations based on task characteristics. Output ONLY raw JSON — no markdown, no prose.`;

      const prompt = `Task: "${taskText}"
Estimated time: ${taskTime || 25} minutes
Energy level: ${taskEnergy || "medium"}

Recommend an ideal single focus session duration. Consider:
- Complex/deep tasks (writing, coding, research): 45–90 min
- Medium tasks: 25–50 min
- Simple/clear tasks: 15–25 min
- High-energy tasks early in day can support longer sessions
- Low-energy tasks benefit from shorter, more frequent sessions

Respond ONLY with raw JSON:
{"minutes": 25, "reason": "One-sentence explanation", "options": [15, 25, 50]}`;

      const raw = await callClaude(MODEL_FAST, [{ role: "user", content: prompt }], system, 300);

      try {
        const rec = JSON.parse(stripJson(raw));
        return res.status(200).json({ recommendation: rec });
      } catch {
        return res.status(200).json({ recommendation: { minutes: 25, reason: "Standard Pomodoro session.", options: [15, 25, 50] } });
      }
    }

    /* ──────────────────────────────────────────────────
       3. FIRST STEP GENERATOR
       Gets the simplest possible first action to beat procrastination
    ────────────────────────────────────────────────── */
    if (type === "first_step") {
      if (!task) return res.status(400).json({ error: "Missing task" });

      const system = `You are a procrastination coach. Give one ultra-simple first action to start a task immediately. Keep it concrete and achievable in under 2 minutes. Reply in one short sentence only.`;

      const raw = await callClaude(
        MODEL_FAST,
        [{ role: "user", content: `Task: "${task}"\n\nWhat is the single simplest first action (max 2 min) to break through resistance and start?` }],
        system,
        150
      );

      return res.status(200).json({ firstStep: raw.trim() });
    }

    /* ──────────────────────────────────────────────────
       4. SMART SCHEDULE GENERATOR
       Picks top tasks and assigns time blocks
    ────────────────────────────────────────────────── */
    if (type === "schedule") {
      const { pendingTasks, currentHour } = req.body;
      if (!pendingTasks || !pendingTasks.length) return res.status(400).json({ error: "No tasks" });

      const system = `You are a strict productivity scheduler. Create realistic, focused daily schedules. Output ONLY raw JSON — no markdown, no prose.`;

      const taskStr = pendingTasks.map(t => `- ${t.text} (${t.time}m, ${t.energy} energy)`).join("\n");
      const startHour = currentHour || 9;

      const prompt = `Current time: ${startHour}:00
Pending tasks:\n${taskStr}

Select the best 4 tasks to maximize today's productivity. 
Order by logical flow (high-energy tasks earlier if before noon, admin/review tasks later).
Assign time blocks starting from ${startHour}:00, with 10-min breaks between sessions.

Return ONLY a raw JSON array:
[{"time": "9:00 AM", "end": "9:45 AM", "text": "Task name"}]`;

      const raw = await callClaude(MODEL_SMART, [{ role: "user", content: prompt }], system, 800);

      try {
        const schedule = JSON.parse(stripJson(raw));
        return res.status(200).json({ schedule });
      } catch {
        return res.status(500).json({ error: "AI returned invalid schedule structure." });
      }
    }

    /* ──────────────────────────────────────────────────
       5. REGULAR CHAT
       General-purpose AI chat with history
    ────────────────────────────────────────────────── */
    if (type === "chat" || !type) {
      if (!message) return res.status(400).json({ error: "Missing message" });

      const messages = [...(history || []), { role: "user", content: message }];
      const system = `You are TaskFlow AI — a focused, warm productivity assistant. Help users stay on task, manage their time, and overcome procrastination. Keep responses concise and actionable.`;

      const raw = await callClaude(MODEL_SMART, messages, system, 800);
      return res.status(200).json({ reply: raw });
    }

    /* ──────────────────────────────────────────────────
       6. NOTES TRANSFORM
       Summarize, rewrite, extract, generate, explain, expand, translate
    ────────────────────────────────────────────────── */
    if (type === "transform") {
      if (!action || !option || !content) {
        return res.status(400).json({ error: "Missing action, option, or content" });
      }

      const prompt = buildTransformPrompt(action, option, content);
      const raw = await callClaude(MODEL_SMART, [{ role: "user", content: prompt }], null, 1500);
      return res.status(200).json({ result: raw });
    }

    return res.status(400).json({ error: `Unknown request type: "${type}"` });

  } catch (err) {
    console.error("TaskFlow API Error:", err.message, err.stack);
    return res.status(500).json({ error: "Server error: " + err.message });
  }
};

/* ──────────────────────────────────────────────────
   TRANSFORM PROMPT BUILDER
────────────────────────────────────────────────── */
function buildTransformPrompt(action, option, content) {
  const ctx = `You are an AI notes transformation engine. Transform content exactly as requested. Never invent facts. Keep formatting clean. Use Markdown when helpful.`;

  const prompts = {
    summarize: {
      brief:    `${ctx}\n\nSummarize in 2–3 sentences. Keep only essential ideas.\n\nNote:\n${content}`,
      detailed: `${ctx}\n\nCreate a detailed summary. Keep all important points, organized clearly.\n\nNote:\n${content}`,
      bullets:  `${ctx}\n\nExtract key points as concise bullet points.\n\nNote:\n${content}`
    },
    rewrite: {
      concise:    `${ctx}\n\nRewrite to be more concise. Remove redundancy, keep meaning.\n\nNote:\n${content}`,
      academic:   `${ctx}\n\nRewrite in formal academic style.\n\nNote:\n${content}`,
      casual:     `${ctx}\n\nRewrite in casual, conversational style.\n\nNote:\n${content}`,
      structured: `${ctx}\n\nRewrite with clear headings, lists, and logical flow.\n\nNote:\n${content}`
    },
    extract: {
      key_points:   `${ctx}\n\nExtract key points. List each one clearly without explanation.\n\nNote:\n${content}`,
      definitions:  `${ctx}\n\nExtract definitions and key terms. Format as "Term: Definition".\n\nNote:\n${content}`,
      concepts:     `${ctx}\n\nExtract main concepts. List each concept and what it means.\n\nNote:\n${content}`,
      action_items: `${ctx}\n\nExtract action items/tasks. If none, say "No action items found".\n\nNote:\n${content}`
    },
    generate: {
      flashcards:     `${ctx}\n\nGenerate 5–8 flashcards.\nFormat:\nQ: Question?\nA: Answer\n\nNote:\n${content}`,
      study_questions:`${ctx}\n\nGenerate study questions.\nFormat:\n- Basic: [question]\n- Deep: [question]\n\nNote:\n${content}`,
      outline:        `${ctx}\n\nCreate a hierarchical outline with proper indentation.\n\nNote:\n${content}`,
      mindmap:        `${ctx}\n\nCreate a text-based mind map showing branches and connections.\n\nNote:\n${content}`,
      study_plan:     `${ctx}\n\nCreate a study plan in time blocks (Day 1, Day 2, etc.) with specific tasks.\n\nNote:\n${content}`
    },
    explain: {
      simple:       `${ctx}\n\nExplain like I'm 5 years old. Simple words, no jargon, use analogies.\n\nNote:\n${content}`,
      intermediate: `${ctx}\n\nExplain like I'm 12. Clear language, some structure, accessible depth.\n\nNote:\n${content}`,
      advanced:     `${ctx}\n\nExplain like a professor. Technical language, detailed analysis, academic tone.\n\nNote:\n${content}`
    },
    expand: {
      full:         `${ctx}\n\nExpand into full paragraphs. Add transitions and explanations.\n\nNote:\n${content}`,
      examples:     `${ctx}\n\nExpand by adding concrete examples for each main point.\n\nNote:\n${content}`,
      explanations: `${ctx}\n\nExpand by adding "why" and "how" explanations for each point.\n\nNote:\n${content}`
    },
    translate: {
      es: `Translate to SPANISH. Keep formatting. Output translation only.\n\nNote:\n${content}`,
      fr: `Translate to FRENCH. Keep formatting. Output translation only.\n\nNote:\n${content}`,
      de: `Translate to GERMAN. Keep formatting. Output translation only.\n\nNote:\n${content}`,
      zh: `Translate to CHINESE (Simplified). Keep formatting. Output translation only.\n\nNote:\n${content}`,
      ja: `Translate to JAPANESE. Keep formatting. Output translation only.\n\nNote:\n${content}`
    }
  };

  return prompts[action]?.[option] || `Transform the following note:\n${content}`;
}
