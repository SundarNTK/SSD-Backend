const mongoose = require("mongoose");
const env = require("./env");

function mongoTarget(uri) {
  try {
    const parsed = new URL(uri);
    const db = parsed.pathname.replace(/^\//, "") || "(default)";
    return `${parsed.host}/${db}`;
  } catch {
    return "configured";
  }
}

async function connectDatabase() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGO_URI);
  console.log(`>>> SSD-Backend: MongoDB connected (${mongoTarget(env.MONGO_URI)})`);

  mongoose.connection.on("error", (err) => {
    console.error(">>> SSD-Backend: MongoDB connection error:", err.message);
  });
}

module.exports = connectDatabase;