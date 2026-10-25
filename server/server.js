/**
 * Reelsidian Real-Time Engine Entry Point
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { PORT } = require('./src/config/constants');
const apiRoutes = require('./src/routes/apiRoutes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Mount API routes
app.use('/api', apiRoutes);
app.get('/api/desktop-ready', (_req, res) => {
  res.json({ service: 'reelsidian' });
});

// Root route serves the dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
const server = app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Reelsidian Real-Time Engine active at http://localhost:${PORT}`);
  console.log(`✨ Local SQLite storage: Reports, goals, graph links, and chats persist locally.`);
  console.log(`📡 SSE Stream: http://localhost:${PORT}/api/events`);
  console.log(`======================================================\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
