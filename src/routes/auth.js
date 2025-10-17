const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/user');

// Render pages
router.get('/', (req, res) => {
    res.render('home');
});

router.get('/register', (req, res) => {
    res.render('register');
});

// API đăng ký
router.post('/register', async (req, res) => {
    try {
        const { fullname, email, phone, password, plate } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ fullname, email, phone, password: hashedPassword, plate });
        await newUser.save();
        
        res.status(201).json({ message: 'Đăng ký thành công' });
    } catch (error) {
        console.error(error);
        res.status(400).json({ message: 'Lỗi khi đăng ký', error: error.message });
    }
});

// API đăng nhập
router.post('/', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: 'Thiếu email hoặc mật khẩu' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ message: 'Sai email hoặc mật khẩu' });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.status(401).json({ message: 'Sai email hoặc mật khẩu' });
        }

        // Generate JWT
        const token = jwt.sign(
            { id: user._id, fullname: user.fullname, email: user.email, plate: user.plate },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        // Save to session
        req.session.user = { 
            id: user._id, 
            fullname: user.fullname, 
            email: user.email, 
            plate: user.plate 
        };
        
        return res.json({ message: 'Đăng nhập thành công', token });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Lỗi server' });
    }
});

module.exports = router;
