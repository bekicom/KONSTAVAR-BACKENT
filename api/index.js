const app = require("../app");
const connectDB = require("../config/db");

let readyPromise = null;

module.exports = async (req, res) => {
  if (!readyPromise) {
    readyPromise = connectDB();
  }

  await readyPromise;
  return app(req, res);
};
