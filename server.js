process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// 1. Middlewares
app.use(cors());
app.use(express.json()); // JSON डेटा रीड करने के लिए
app.use(express.static('public')); // public फोल्डर की फ्रंटएंड फाइलों को इंटरनेट पर दिखाने के लिए

// 2. Neon Database Connection Setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // आपके लोकल कंप्यूटर पर SSL एरर को बाईपास करने के लिए
  }
});

// टेस्ट डेटाबेस कनेक्शन
pool.connect((err, client, release) => {
  if (err) {
    return console.error('डेटाबेस कनेक्शन में गड़बड़ है:', err.stack);
  }
  console.log('🎉 Neon PostgreSQL डेटाबेस से सफलतापूर्वक कनेक्शन हो गया है!');
  release();
});

// 3. API Routes (रास्ते)

// [GET] सभी हैबिट्स को उनकी पोजीशन (क्रम) के हिसाब से लाना
app.get('/api/habits', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM habits ORDER BY position ASC, id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('सर्वर एरर: आदतें लाने में असमर्थ।');
  }
});

// [POST] नई आदत को सबसे आखिरी पोजीशन पर जोड़ना
app.post('/api/habits', async (req, res) => {
  try {
    const { name, category, daily_goal } = req.body;
    
    // सबसे बड़ी पोजीशन पता करें ताकि नई आदत उसके बाद आए
    const maxPosResult = await pool.query('SELECT MAX(position) as max_pos FROM habits');
    const nextPosition = (maxPosResult.rows[0].max_pos || 0) + 1;

    const newHabit = await pool.query(
      'INSERT INTO habits (name, category, daily_goal, position) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, category, daily_goal, nextPosition]
    );
    res.json(newHabit.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('सर्वर एरर: हैबिट सेव नहीं हो सकी।');
  }
});

// [PUT] आदत का नाम एडिट करना (Edit Button के लिए)
app.put('/api/habits/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    await pool.query('UPDATE habits SET name = $1 WHERE id = $2', [name, id]);
    res.json({ success: true, message: 'आदत का नाम बदल दिया गया है!' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('एडिट करने में समस्या आई।');
  }
});

// [DELETE] आदत को डिलीट करना (Delete Button के लिए)
app.delete('/api/habits/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM habits WHERE id = $1', [id]);
    res.json({ success: true, message: 'आदत को डिलीट कर दिया गया है।' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('डिलीट करने में समस्या आई।');
  }
});

// [PUT] आदत की पोजीशन बदलना (जैसे दूसरे नंबर पर सेट करना)
app.put('/api/habits-reorder', async (req, res) => {
  try {
    const { habitId, targetPosition } = req.body; // targetPosition 1 से शुरू होगी
    
    // सभी आदतें लाएं
    const habitsResult = await pool.query('SELECT id FROM habits ORDER BY position ASC, id ASC');
    let habits = habitsResult.rows.map(h => h.id);

    // वर्तमान आदत को उसकी पुरानी जगह से हटाएं
    habits = habits.filter(id => id !== parseInt(habitId));

    // उसे टारगेट पोजीशन (इंडेक्स = targetPosition - 1) पर फिट करें
    const insertIndex = Math.max(0, Math.min(targetPosition - 1, habits.length));
    habits.splice(insertIndex, 0, parseInt(habitId));

    // डेटाबेस में सभी की नई पोजीशन अपडेट करें
    for (let i = 0; i < habits.length; i++) {
      await pool.query('UPDATE habits SET position = $1 WHERE id = $2', [i + 1, habits[i]]);
    }

    res.json({ success: true, message: 'पोजीशन सफलतापूर्वक अपडेट हो गई!' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('री-ऑर्डर करने में समस्या आई।');
  }
});

// [GET] सभी आदतें और उनके इस महीने के लॉग्ज़ (Checkboxes) लाना
app.get('/api/habits-with-logs', async (req, res) => {
  try {
    const { month, year } = req.query; // उदा. month = 7, year = 2026
    
    // सभी हैबिट्स पोजीशन के अनुसार लाएं
    const habitsResult = await pool.query('SELECT * FROM habits ORDER BY position ASC, id ASC');
    const habits = habitsResult.rows;

    // इस महीने के सभी टिक/लॉग्ज़ लाएं
    const logsResult = await pool.query(
      `SELECT * FROM habit_logs 
       WHERE EXTRACT(MONTH FROM log_date) = $1 
       AND EXTRACT(YEAR FROM log_date) = $2`,
      [month, year]
    );
    const logs = logsResult.rows;

    // आदतों और उनके लॉग्ज़ को मिलाकर भेजें
    const responseData = habits.map(habit => {
      const habitLogs = logs
        .filter(log => log.habit_id === habit.id && log.completed)
        .map(log => new Date(log.log_date).getDate()); // केवल तारीखों की लिस्ट जैसे [1, 3, 5]

      return {
        ...habit,
        completed_days: habitLogs
      };
    });

    res.json(responseData);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('डेटा लोड करने में असमर्थ।');
  }
});

// [POST] किसी खास तारीख पर आदत को टिक/अनटिक करना
app.post('/api/toggle-habit', async (req, res) => {
  try {
    const { habit_id, date, completed } = req.body; // date format: 'YYYY-MM-DD'

    // अगर पहले से एंट्री है तो अपडेट करें, नहीं तो नई एंट्री डालें
    await pool.query(
      `INSERT INTO habit_logs (habit_id, log_date, completed) 
       VALUES ($1, $2, $3)
       ON CONFLICT (habit_id, log_date) 
       DO UPDATE SET completed = EXCLUDED.completed`,
      [habit_id, date, completed]
    );

    res.json({ success: true, message: 'स्टेटस अपडेट हो गया!' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('स्टेटस अपडेट करने में त्रुटि।');
  }
});

// 4. Server Start
app.listen(PORT, () => {
  console.log(`🚀 सर्वर http://localhost:${PORT} पर चालू हो चुका है!`);
});