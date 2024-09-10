// app.js
const YahooFantasy = require('./index.js');
const express = require('express');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const yf = new YahooFantasy(
  process.env.YAHOO_APPLICATION_KEY,
  process.env.YAHOO_APPLICATION_SECRET
);

app.get('/', (req, res) => {
  res.send('Yahoo Fantasy API app is running!');
});

app.get('/nba/game', async (req, res) => {
  try {
    const data = await yf.game.meta('nba');
    res.json(data);
  } catch (error) {
    console.error('Error fetching NBA game data:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});