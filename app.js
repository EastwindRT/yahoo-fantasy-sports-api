const express = require('express');
const YahooFantasy = require('yahoo-fantasy');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = process.env.PORT || 10000;

// Error logging middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

console.log('YAHOO_APPLICATION_KEY:', process.env.YAHOO_APPLICATION_KEY ? 'Set' : 'Not set');
console.log('YAHOO_APPLICATION_SECRET:', process.env.YAHOO_APPLICATION_SECRET ? 'Set' : 'Not set');
console.log('YAHOO_REDIRECT_URI:', process.env.YAHOO_REDIRECT_URI);

const yf = new YahooFantasy(
  process.env.YAHOO_APPLICATION_KEY,
  process.env.YAHOO_APPLICATION_SECRET,
  null, // Token (we'll get this after authentication)
  process.env.YAHOO_REDIRECT_URI
);

app.get('/', (req, res) => {
  res.send('Yahoo Fantasy API app is running!');
});

app.get('/auth/yahoo', (req, res) => {
  const authorizationUrl = yf.auth().url();
  console.log('Authorization URL:', authorizationUrl); // Add this line for debugging
  res.redirect(authorizationUrl);
});

app.get('/auth/yahoo/callback', (req, res) => {
  yf.auth().token(req.query.code, (err, token) => {
    if (err) {
      console.error('Authentication error:', err);
      res.status(500).json({ error: 'Authentication failed', details: err.message });
    } else {
      // Store the token securely - in a real app, you'd use a database or secure session
      global.yahooToken = token;
      res.redirect('/dashboard');
    }
  });
});

app.get('/dashboard', (req, res) => {
  if (!global.yahooToken) {
    res.redirect('/auth/yahoo');
  } else {
    res.send('Authenticated! You can now make API calls.');
  }
});

app.get('/nba/game', async (req, res) => {
  try {
    const data = await yf.game.meta('nba');
    res.json(data);
  } catch (error) {
    console.error('Error fetching NBA game data:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

app.get('/myLeagues', (req, res) => {
  if (!global.yahooToken) {
    res.redirect('/auth/yahoo');
    return;
  }

  yf.user.game_leagues('nba', (err, data) => {
    if (err) {
      console.error('Error fetching leagues:', err);
      res.status(500).json({ error: 'Failed to fetch leagues', details: err.message });
    } else {
      res.json(data);
    }
  });
});

app.get('/team/:team_key/roster', (req, res) => {
  if (!global.yahooToken) {
    res.redirect('/auth/yahoo');
    return;
  }

  yf.team.roster(req.params.team_key, (err, data) => {
    if (err) {
      console.error('Error fetching team roster:', err);
      res.status(500).json({ error: 'Failed to fetch team roster', details: err.message });
    } else {
      res.json(data);
    }
  });
});

// Debug route to check environment variables
app.get('/debug', (req, res) => {
  res.json({
    YAHOO_APPLICATION_KEY: process.env.YAHOO_APPLICATION_KEY ? 'Set' : 'Not set',
    YAHOO_APPLICATION_SECRET: process.env.YAHOO_APPLICATION_SECRET ? 'Set' : 'Not set',
    YAHOO_REDIRECT_URI: process.env.YAHOO_REDIRECT_URI
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});