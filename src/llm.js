const { GoogleGenerativeAI } = require("@google/generative-ai");

// GenAI API and model version
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

async function getLLMResponse(prompt) {
    console.log("Menerima prompt untuk LLM:", prompt);
    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        console.log("Respon LLM:", text);
        return text;
    } catch (error) {
        console.error("Error saat menghubungi Gemini API:", error);
        return "Maaf, terjadi kesalahan saat menghubungi 'otak' saya.";
    }
}

module.exports = { getLLMResponse };