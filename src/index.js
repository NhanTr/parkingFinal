const express = require('express');
const http = require('http');
const path = require('path');
require('dotenv').config();


// Import configurations
const { connectDatabase } = require('./config/database');
const { setupHandlebars } = require('./config/handlebars');
const { setupSession } = require('./config/session');

// Import middleware
const errorHandler = require('./middleware/errorHandler');

// Import WebSocket
const { setupWebSocket } = require('./websocket/websocketServer');

// Import routes
const authRoutes = require('./routes/auth');
const parkingRoutes = require('./routes/parking');
const managerRoutes = require('./routes/manager');
const cameraRoutes = require('./routes/camera');
const apiRoutes = require('./routes/api');
const bookingCameraRoutes = require('./routes/bookingCamera');


const app = express();
const port = process.env.PORT || 3000;

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));


// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Connect to MongoDB
connectDatabase();

// Setup Handlebars
setupHandlebars(app);

// Setup Session
setupSession(app);

// Setup Morgan (logging)
const morgan = require('morgan');
app.use(morgan('combined'));

// Create HTTP server
const server = http.createServer(app);

// Setup WebSocket
setupWebSocket(server);

// Routes
app.use('/', authRoutes);
app.use('/', parkingRoutes);
app.use('/manager', managerRoutes);
app.use('/camera', cameraRoutes);
app.use('/api', apiRoutes);
app.use('/api/booking-camera', bookingCameraRoutes);

// Error handling
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Page not found',
        timestamp: new Date().toISOString()
    });
});

// Start server
server.listen(port, () => {
    console.log(`🚀 Server running at http://localhost:${port}`);
    console.log('✅ All systems initialized successfully!');
});

module.exports = server;

