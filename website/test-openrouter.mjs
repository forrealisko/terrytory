import fs from "fs";
import path from "path";
const envPath = "/Users/poisonforreal/Library/Mobile Documents/com~apple~CloudDocs/POISON/business/terrytory/website/.env.local";
const envContent = fs.readFileSync(envPath, "utf-8");
const match = envContent.match(/OPENROUTER_API_KEY=(.+)/);
const key = match ? match[1].trim() : null;

if (!key) {
  console.log("No OPENROUTER_API_KEY found");
  process.exit(1);
}

async function test() {
  console.log("Testing OpenRouter DALL-E 3...");
  const response = await fetch("https://openrouter.ai/api/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://sys.terrytory.com",
        "X-Title": "Terrytory Content Generator",
      },
      body: JSON.stringify({
        model: "openai/dall-e-3",
        prompt: "A test image",
        n: 1,
        size: "1792x1024",
        quality: "standard",
      }),
    });
    
    const text = await response.text();
    console.log("Status:", response.status);
    console.log("Response:", text);
}
test();
