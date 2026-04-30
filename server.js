require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const connectDB = require("./config/db");

const app = express();

// 🔹 Middlewares
app.use(express.json());
app.use(cors());
app.use(helmet());
app.use(morgan("dev"));

// 🔹 Routes
app.use("/api", require("./routes/mainRoutes"));

// 🔹 404 handler
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "0.0.0.0";

const startServer = async () => {
  await connectDB();

  app.listen(PORT, HOST, () => {
    console.log(`🚀 KONSTAVAR server running on ${HOST}:${PORT}`);
  });
};

startServer();

const stopMemoryServer = connectDB.stopMemoryServer;
const shutdown = async () => {
  if (typeof stopMemoryServer === "function") {
    await stopMemoryServer();
  }
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
