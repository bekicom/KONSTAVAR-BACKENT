const mongoose = require("mongoose");

let cachedConnection = null;
let cachedPromise = null;

const connectDB = async () => {
  if (cachedConnection) {
    return cachedConnection;
  }

  if (cachedPromise) {
    return cachedPromise;
  }

  try {
    cachedPromise = mongoose.connect(process.env.MONGO_URI);
    const conn = await cachedPromise;
    cachedConnection = conn;

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    cachedPromise = null;
    console.error("❌ MongoDB connection error:", error.message);
    throw error;
  }
};

module.exports = connectDB;
