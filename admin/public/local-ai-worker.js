import * as webllm from "https://esm.run/@mlc-ai/web-llm";

let engine = null;
let loadedModel = "";

function progressCallback(report) {
  postMessage({ type: "progress", progress: report.progress || 0, text: report.text || "正在加载本地模型…" });
}

async function ensureEngine(preferredModel) {
  if (engine && loadedModel === preferredModel) return engine;
  const fallback = "Qwen3-0.6B-q4f32_1-MLC";
  try {
    engine = await webllm.CreateMLCEngine(preferredModel, { initProgressCallback: progressCallback });
    loadedModel = preferredModel;
  } catch (_) {
    engine = await webllm.CreateMLCEngine(fallback, { initProgressCallback: progressCallback });
    loadedModel = fallback;
  }
  return engine;
}

self.addEventListener("message", async (event) => {
  if (event.data.type !== "enrich") return;
  const { requestId, term, preferredModel } = event.data;
  try {
    const model = await ensureEngine(preferredModel);
    const response = await model.chat.completions.create({
      messages: [
        { role: "system", content: "You are an IELTS English-Chinese lexicographer. Return compact JSON only. Use British English. Never invent a different spelling." },
        { role: "user", content: `Explain this English word or phrase for IELTS study: ${term}. Return exactly one JSON object with string keys meaning, phonetic, and reason. Use one or two concise Chinese senses, IPA without slashes, and one short Chinese usage note. /no_think` },
      ],
      temperature: 0.1,
      max_tokens: 220,
      response_format: { type: "json_object" },
    });
    const content = String(response.choices[0].message.content || "").trim();
    let value;
    try {
      value = JSON.parse(content);
    } catch (_) {
      const object = content.match(/\{[\s\S]*\}/)?.[0];
      if (!object) throw new Error("本地模型未返回结构化结果");
      value = JSON.parse(object);
    }
    if (!value.meaning) throw new Error("本地模型未返回中文释义");
    postMessage({ type: "result", requestId, value });
  } catch (error) {
    postMessage({ type: "error", requestId, error: error.message });
  }
});
