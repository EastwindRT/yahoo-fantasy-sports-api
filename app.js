const express = require('express');
const YahooFantasy = require('yahoo-fantasy');
const { AuthorizationCode } = require('simple-oauth2');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
const port = process.env.PORT || 10000;

// Logging environment variables (be careful not to log sensitive information in production)
console.log('YAHOO_APPLICATION_KEY:', process.env.YAHOO_APPLICATION_KEY ? 'Set' : 'Not set');
console.log('YAHOO_APPLICATION_SECRET:', process.env.YAHOO_APPLICATION_SECRET ? 'Set' : 'Not set');
console.log('YAHOO_REDIRECT_URI:', process.env.YAHOO_REDIRECT_URI);

// Initialize YahooFantasy
const yf = new YahooFantasy(
  process.env.YAHOO_APPLICATION_KEY,
  process.env.YAHOO_APPLICATION_SECRET,
  null,
  process.env.YAHOO_REDIRECT_URI
);

// Log YahooFantasy object details without circular references
console.log('YahooFantasy object properties:', Object.keys(yf));
console.log('YahooFantasy auth method:', yf.auth ? 'Exists' : 'Does not exist');
console.log('YahooFantasy auth type:', typeof yf.auth);

// Initialize simple-oauth2 client
const client = new AuthorizationCode({
  client: {
    id: process.env.YAHOO_APPLICATION_KEY,
    secret: process.env.YAHOO_APPLICATION_SECRET
  },
  auth: {
    tokenHost: 'https://api.login.yahoo.com',
    authorizePath: '/oauth2/request_auth',
    tokenPath: '/oauth2/get_token'
  }
});

const redirectUri = process.env.YAHOO_REDIRECT_URI;

// Routes
app.get('/', (req, res) => {
  res.send('Yahoo Fantasy API app is running! <a href="/auth/yahoo">Authenticate with Yahoo</a>');
});

app.get('/check-yf', (req, res) => {
  res.json({
    yfProperties: Object.keys(yf),
    authExists: !!yf.auth,
    authType: typeof yf.auth,
    authIsFunction: typeof yf.auth === 'function',
    authProperties: yf.auth ? Object.keys(yf.auth) : []
  });
});

app.get('/auth/yahoo', (req, res) => {
  const authorizationUri = client.authorizeURL({
    redirect_uri: redirectUri,
    scope: 'fspt-w',
  });
  res.redirect(authorizationUri);
});

app.get('/auth/yahoo/callback', async (req, res) => {
  console.log('Entering /auth/yahoo/callback route');
  console.log('Query parameters:', req.query);

  if (!req.query.code) {
    console.error('No code provided in callback');
    return res.status(400).send('No code provided in callback');
  }

  try {
    const tokenParams = {
      code: req.query.code,
      redirect_uri: redirectUri
    };
    const accessToken = await client.getToken(tokenParams);
    console.log('Access Token:', accessToken.token);

    // Store the token
    global.yahooToken = accessToken.token;

    // Use the token to initialize YahooFantasy
    yf.setUserToken(accessToken.token.access_token);

    res.redirect('/dashboard');
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ 
      error: 'Authentication failed', 
      details: error.message,
      stack: error.stack 
    });
  }
});

app.get('/dashboard', (req, res) => {
  if (!global.yahooToken) {
    res.redirect('/auth/yahoo');
  } else {
    res.send('Authenticated! You can now make API calls. Try <a href="/test-api">Test API</a> or <a href="/myLeagues">My Leagues</a>');
  }
});

app.get('/test-api', async (req, res) => {
  if (!global.yahooToken) {
    res.redirect('/auth/yahoo');
  } else {
    try {
      const data = await new Promise((resolve, reject) => {
        yf.user.games((err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      });
      res.json(data);
    } catch (error) {
      console.error('Error fetching user games:', error);
      res.status(500).json({ error: 'Failed to fetch user games', details: error.message });
    }
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
    YAHOO_REDIRECT_URI: process.env.YAHOO_REDIRECT_URI,
    PORT: process.env.PORT || 10000
  });
});

// Custom error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).send('Something went wrong: ' + err.message);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});