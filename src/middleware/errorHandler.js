function errorHandler(err, req, res, next) {
    console.error('⚠️ Server error:', err.stack);
    res.status(500).json({
        error: 'Internal server error',
        message: err.message,
        timestamp: new Date().toISOString()
    });
}

module.exports = errorHandler;

