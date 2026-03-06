import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import buildingsRouter from './routes/buildings.js';
import floorsRouter from './routes/floors.js';
import roomsRouter from './routes/rooms.js';
import navigationRouter from './routes/navigation.js';
import qrRouter from './routes/qr.js';
import authRouter from './routes/auth.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Routes
app.use('/api/auth', authRouter);
app.use('/api/buildings', buildingsRouter);
app.use('/api/floors', floorsRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/navigation', navigationRouter);
app.use('/api/qr', qrRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'CampusNav API running' });
});

app.listen(PORT, () => {
  console.log(`🚀 CampusNav API running on port ${PORT}`);
});
