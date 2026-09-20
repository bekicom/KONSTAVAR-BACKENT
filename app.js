require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const app = express();

app.use(express.json());
app.use(cors());
app.use(helmet());
app.use(morgan("dev"));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "konstavar",
    version: "1.0.0",
    cwd: process.cwd(),
    nodeEnv: process.env.NODE_ENV || "development",
    mongoConfigured: Boolean(process.env.MONGO_URI),
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.use("/api", require("./routes/mainRoutes"));

app.use((req, res) => {
  res.status(404).json({
    message: "Route not found",
    method: req.method,
    path: req.originalUrl || req.url,
  });
});

module.exports = app;
