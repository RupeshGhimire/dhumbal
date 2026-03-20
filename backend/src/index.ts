import express from 'express';
import cors from 'cors';
import gameRoutes from './routes/gameRoutes';

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Game routes
app.use('/api/games', gameRoutes);

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(Number(PORT), HOST, () => {
  console.log(`Dhumbal server running on http://localhost:${PORT}`);
  console.log(`Dhumbal server listening on ${HOST}:${PORT} for LAN connections`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

export default app;
