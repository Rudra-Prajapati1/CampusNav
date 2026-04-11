import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import buildingsRouter from "./routes/buildings.js";
import floorsRouter from "./routes/floors.js";
import roomsRouter from "./routes/rooms.js";
import navigationRouter from "./routes/navigation.js";
import qrRouter from "./routes/qr.js";
import authRouter from "./routes/auth.js";
import mapsRouter from "./routes/maps.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  }),
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Routes
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/buildings", buildingsRouter);
app.use("/api/v1/floors", floorsRouter);
app.use("/api/v1/rooms", roomsRouter);
app.use("/api/v1/navigation", navigationRouter);
app.use("/api/v1/qr", qrRouter);
app.use("/api/v1/maps", mapsRouter);
app.use("/api/maps", mapsRouter);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "CampusNav API running" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: "Something went wrong",
    message: err.message,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 CampusNav API running on port ${PORT}`);
});
