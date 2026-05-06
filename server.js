require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const morgan = require("morgan");
const axios = require("axios");

const app = express();

// ================= MIDDLEWARE =================
app.use(helmet());
app.use(morgan("dev"));

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ================= DB =================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.log("❌ DB Error:", err.message));

// ================= MODELS =================
const User = mongoose.model(
  "User",
  new mongoose.Schema({
    email: { type: String, unique: true },
    password: String,
  })
);

const Chat = mongoose.model(
  "Chat",
  new mongoose.Schema(
    {
      userId: String,
      title: String,
      messages: [{ text: String, sender: String }],
    },
    { timestamps: true }
  )
);

// ================= AUTH =================
const auth = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token" });

  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
};

// ================= RATE LIMIT =================
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
});

// ================= OLLAMA AI =================

   // ================= SMART AI (OLLAMA + ADVANCED FALLBACK) =================
async function getAIResponse(message, history = []) {
  try {
    const res = await axios.post(
      "http://localhost:11434/api/generate",
      {
        model: "phi",
        prompt: message,
        stream: false,
      },
      { timeout: 20000 }
    );

    const reply = res.data?.response;
    if (reply && reply.trim()) return reply.trim();

    throw new Error("Empty response");
  } catch (err) {
    console.log("⚠️ Using SMART FAKE AI");

    // ================= CONTEXT =================
    const lastUserMsg = history
      .slice()
      .reverse()
      .find((m) => m.sender === "user")?.text || "";

    const text = message.toLowerCase();

    // ================= DYNAMIC RESPONSES =================
    if (text.includes("hi") || text.includes("hello")) {
      return `Hey 👋 I'm your AI assistant. Ask me anything — coding, projects, or interviews!`;
    }

    if (text.includes("how are you")) {
      return "I'm running perfectly 🚀 Ready to help you build something awesome.";
    }

    if (text.includes("resume")) {
      return `To improve your resume:
• Add 2 strong projects (like your AI Resume Builder)
• Mention tech stack clearly
• Quantify impact (e.g., "improved performance by 30%")`;
    }

    if (text.includes("project")) {
      return `A strong project should have:
• Real-world problem
• Clean UI (React)
• Backend (Node + DB)
• Bonus: AI integration (like you're doing 🔥)`;
    }

    if (text.includes("interview")) {
      return `Crack interviews by focusing on:
• DSA (arrays, trees, graphs)
• Projects explanation
• Communication (very important!)`;
    }

    if (text.includes("react")) {
      return `React tip:
Break UI into components, manage state properly, and avoid unnecessary re-renders.`;
    }

    if (text.includes("node")) {
      return `Node.js tip:
Use async/await properly and structure your backend with controllers + routes.`;
    }

    if (text.includes("mongodb")) {
      return `MongoDB tip:
Design schemas based on your queries, not just data. Optimize reads.`;
    }

    // ================= CONTEXT-AWARE RESPONSE =================
    if (lastUserMsg && lastUserMsg !== message) {
      return `You asked earlier: "${lastUserMsg}"

Now for this:
"${message}"

👉 Here's a helpful answer:
Focus on solving the problem step by step and keep your logic clear.`;
    }

    // ================= RANDOMIZED HUMAN-LIKE RESPONSES =================
    const randomReplies = [
      "Interesting question 🤔 — here's what I think: break it into smaller parts and solve step by step.",
      "Good one 🔥 — focus on logic first, then optimize.",
      "Let’s think about it practically: what is the input and expected output?",
      "Nice — you're thinking in the right direction. Try approaching it with a clean structure.",
    ];

    return randomReplies[Math.floor(Math.random() * randomReplies.length)];
  }
}

// ================= ROUTES =================
app.get("/", (req, res) => {
  res.json({ status: "Backend running 🚀" });
});

// AUTH
app.post("/api/signup", limiter, async (req, res) => {
  const { email, password } = req.body;

  const exists = await User.findOne({ email });
  if (exists) return res.status(400).json({ error: "User exists" });

  const hash = await bcrypt.hash(password, 10);
  await User.create({ email, password: hash });

  res.json({ success: true });
});

app.post("/api/login", limiter, async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ error: "User not found" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ error: "Wrong password" });

  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

  res.json({ token });
});

// CHATS
app.get("/api/chats", auth, async (req, res) => {
  const chats = await Chat.find({ userId: req.userId }).sort({
    createdAt: -1,
  });
  res.json(chats);
});

app.delete("/api/chat/:id", auth, async (req, res) => {
  await Chat.deleteOne({ _id: req.params.id, userId: req.userId });
  res.json({ success: true });
});

// CHAT
app.post("/api/chat", auth, limiter, async (req, res) => {
  try {
    const { message, chatId } = req.body;

    let chat = null;

    if (chatId) {
      chat = await Chat.findOne({ _id: chatId, userId: req.userId });
    }

    if (!chat) {
      chat = await Chat.create({
        userId: req.userId,
        title: message.slice(0, 30),
        messages: [],
      });
    }

    chat.messages.push({ text: message, sender: "user" });

    const aiReply = await getAIResponse(message);

    chat.messages.push({ text: aiReply, sender: "ai" });

    await chat.save();

    res.json({
      reply: aiReply,
      chatId: chat._id,
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ================= START =================
app.listen(5000, () => {
  console.log("🚀 Server running on port 5000");
});