require("dotenv").config();

const app = require("./app");
const connectDB = require("./config/db");

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
