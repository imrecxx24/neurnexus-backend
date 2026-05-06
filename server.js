
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
app.get("/", (req, res) => {
  res.json({ status: "Backend running 🚀" });
});
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

// ================= AI (OLLAMA + FALLBACK) =================
async function getAIResponse(message, history = []) {
  try {
    const res = await axios.post(
      "http://localhost:11434/api/generate",
      {
        model: "phi",
        prompt: message,
        stream: false,
      },
      { timeout: 15000 }
    );

    const reply = res.data?.response;
    if (reply && reply.trim()) return reply.trim();

    throw new Error("Empty response");
  } catch (err) {
    console.log("⚠️ Using fallback AI");

    const text = message.toLowerCase();

    if (text.includes("hi") || text.includes("hello")) {
      return "Hey 👋 I'm your AI assistant. Ask me anything!";
    }

    if (text.includes("how are you")) {
      return "I'm running perfectly 🚀 Ready to help!";
    }

    if (text.includes("resume")) {
      return "Add strong projects, clear tech stack, and measurable impact.";
    }

    if (text.includes("project")) {
      return "Build real-world apps with frontend + backend + database.";
    }

    if (text.includes("interview")) {
      return "Focus on DSA, projects, and communication.";
    }

    const replies = [
      "Interesting 🤔 — break it step by step.",
      "Good question 🔥 — focus on logic first.",
      "Think about input → process → output.",
    ];

    return replies[Math.floor(Math.random() * replies.length)];
  }
}

// ================= ROUTES =================

// ✅ ROOT (VERY IMPORTANT)
app.get("/", (req, res) => {
  res.json({ status: "Backend running 🚀" });
});

// AUTH
app.post("/api/signup", limiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ error: "User exists" });

    const hash = await bcrypt.hash(password, 10);
    await User.create({ email, password: hash });

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/login", limiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "User not found" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: "Wrong password" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({ token });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
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

    const aiReply = await getAIResponse(message, chat.messages);

    chat.messages.push({ text: aiReply, sender: "ai" });

    await chat.save();

    res.json({
      reply: aiReply,
      chatId: chat._id,
    });
  } catch (err) {
    console.log("Chat error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ================= START =================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});