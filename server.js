// server.js
require('dotenv').config();
const express = require('express');
const YahooFantasy = require('./index.js');

const app = express();
const port = process.env.PORT || 3000;

const yf = new YahooFantasy(
  process.env.YAHOO_APPLICATION_KEY,
  process.env.YAHOO_APPLICATION_SECRET,
  null,
  'http://localhost:3000/auth/callback' // Update this with your Render URL when deploying
);

app.get('/', (req, res) => {
  res.send('Welcome to the Yahoo Fantasy API app!');
});

app.get('/auth', (req, res) => {
  yf.auth(res);
});

app.get('/auth/callback', (req, res) => {
  yf.authCallback(req, (err) => {
    if (err) {
      res.status(500).json({ error: err });
    } else {
      res.send('Authentication successful! You can now use the API.');
    }
  });
});

app.get('/nba/metadata', async (req, res) => {
  try {
    const data = await yf.game.meta('nba');
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/nba/player/:playerId', async (req, res) => {
  try {
    const data = await yf.player.stats([`nba.p.${req.params.playerId}`]);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});