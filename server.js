require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

pool.connect((err) => {
    if (err) {
        console.error('डेटाबेस कनेक्शन में गड़बड़ है:', err);
    } else {
        console.log('🎉 Neon PostgreSQL डेटाबेस से सफलतापूर्वक कनेक्शन हो गया है!');
    }
});

// ==========================================
// 🔐 सुरक्षा गेटवे (Authentication Middleware)
// ==========================================
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'लॉगिन आवश्यक है!' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'अवैध टोकन, दोबारा लॉगिन करें।' });
        req.user = user;
        next();
    });
};

// ==========================================
// 👤 USER AUTHENTICATION ROUTES (लॉगिन/साइनअप)
// ==========================================

// 1. SIGNUP - नया यूजर रजिस्टर करें
app.post('/api/auth/signup', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'ईमेल और पासवर्ड दोनों भरें!' });

    try {
        const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userExists.rows.length > 0) return res.status(400).json({ error: 'यह ईमेल पहले से रजिस्टर्ड है!' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await pool.query(
            'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email',
            [email, hashedPassword]
        );

        res.status(201).json({ message: 'रजिस्ट्रेशन सफल रहा!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'सर्वर में कोई गड़बड़ी है।' });
    }
});

// 2. LOGIN - यूजर लॉगिन करें और टोकन दें
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userRes.rows.length === 0) return res.status(400).json({ error: 'गलत ईमेल या पासवर्ड!' });

        const user = userRes.rows[0];
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ error: 'गलत ईमेल या पासवर्ड!' });

        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user.id, email: user.email } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'सर्ver में कोई गड़बड़ी है।' });
    }
});

// ==========================================
// 📅 HABITS ROUTES (केवल लॉगिन यूजर के लिए)
// ==========================================

// 1. GET ALL HABITS WITH LOGS (सिर्फ इस यूजर की आदतें)
app.get('/api/habits-with-logs', authenticateToken, async (req, res) => {
    const { month, year } = req.query;
    const userId = req.user.id;

    try {
        const habitsRes = await pool.query(
            'SELECT * FROM habits WHERE user_id = $1 ORDER BY position ASC, id ASC',
            [userId]
        );
        const habits = habitsRes.rows;

        const logsRes = await pool.query(
            `SELECT habit_id, EXTRACT(DAY FROM date)::INTEGER as day 
             FROM habit_logs 
             WHERE habit_id IN (SELECT id FROM habits WHERE user_id = $1)
             AND EXTRACT(MONTH FROM date) = $2 
             AND EXTRACT(YEAR FROM date) = $3
             AND completed = true`,
            [userId, month, year]
        );
        const logs = logsRes.rows;

        const result = habits.map(habit => {
            const completedDays = logs
                .filter(log => log.habit_id === habit.id)
                .map(log => log.day);
            return { ...habit, completed_days: completedDays };
        });

        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// 2. ADD HABIT (यूजर ID के साथ जोड़ें)
app.post('/api/habits', authenticateToken, async (req, res) => {
    const { name, category, daily_goal } = req.body;
    const userId = req.user.id;

    try {
        const posRes = await pool.query('SELECT COALESCE(MAX(position), 0) as max_pos FROM habits WHERE user_id = $1', [userId]);
        const nextPosition = posRes.rows[0].max_pos + 1;

        const newHabit = await pool.query(
            'INSERT INTO habits (name, category, daily_goal, position, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [name, category || 'General', daily_goal || 1, nextPosition, userId]
        );
        res.json(newHabit.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// 3. TOGGLE HABIT
app.post('/api/toggle-habit', authenticateToken, async (req, res) => {
    const { habit_id, date, completed } = req.body;
    try {
        await pool.query(
            `INSERT INTO habit_logs (habit_id, date, completed) 
             VALUES ($1, $2, $3)
             ON CONFLICT (habit_id, date) 
             DO UPDATE SET completed = $3`,
            [habit_id, date, completed]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// 4. EDIT HABIT NAME
app.put('/api/habits/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    const userId = req.user.id;

    try {
        const result = await pool.query(
            'UPDATE habits SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
            [name, id, userId]
        );
        if (result.rows.length === 0) return res.status(403).json({ error: 'अनधिकृत!' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. DELETE HABIT
app.delete('/api/habits/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        const result = await pool.query('DELETE FROM habits WHERE id = $1 AND user_id = $2 RETURNING *', [id, userId]);
        if (result.rows.length === 0) return res.status(403).json({ error: 'अनधिकृत!' });
        res.json({ success: true, message: 'आदत हटा दी गई है।' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. REORDER HABITS
app.put('/api/habits-reorder', authenticateToken, async (req, res) => {
    const { habitId, targetPosition } = req.body;
    const userId = req.user.id;

    try {
        const habitRes = await pool.query('SELECT position FROM habits WHERE id = $1 AND user_id = $2', [habitId, userId]);
        if (habitRes.rows.length === 0) return res.status(404).json({ error: 'Habit not found' });

        const currentPosition = habitRes.rows[0].position;

        if (currentPosition < targetPosition) {
            await pool.query(
                'UPDATE habits SET position = position - 1 WHERE user_id = $1 AND position > $2 AND position <= $3',
                [userId, currentPosition, targetPosition]
            );
        } else if (currentPosition > targetPosition) {
            await pool.query(
                'UPDATE habits SET position = position + 1 WHERE user_id = $1 AND position >= $2 AND position < $3',
                [userId, targetPosition, currentPosition]
            );
        }

        await pool.query('UPDATE habits SET position = $1 WHERE id = $2 AND user_id = $3', [targetPosition, habitId, userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// server.js के बिल्कुल नीचे यह लाइन जोड़ें ताकि Vercel इसे एक्सपोर्ट कर सके
module.exports = app;
