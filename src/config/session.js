const session = require('express-session');

function setupSession(app) {
    app.use(session({
        secret: process.env.SESSION_SECRET || 'nhantr1412',
        resave: false,
        saveUninitialized: true,
        cookie: {
            secure: false,
            maxAge: 24 * 60 * 60 * 1000
        }
    }));
}

module.exports = { setupSession };

