const express = require('express');
const session = require('express-session');
const YahooFantasy = require('yahoo-fantasy');
const { AuthorizationCode } = require('simple-oauth2');
const dotenv = require('dotenv');
const path = require('path');

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

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'your_session_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Routes
app.get('/', (req, res) => {
  res.send('Yahoo Fantasy API app is running! <a href="/auth/yahoo">Authenticate with Yahoo</a>');
});

app.get('/auth/yahoo', (req, res) => {
  try {
    const authorizationUri = client.authorizeURL({
      redirect_uri: process.env.YAHOO_REDIRECT_URI,
      scope: 'openid fspt-r',
    });
    console.log('Generated authorization URI:', authorizationUri);
    res.redirect(authorizationUri);
  } catch (error) {
    console.error('Error generating authorization URL:', error);
    res.status(500).json({ 
      error: 'Failed to generate authorization URL', 
      details: error.message,
      stack: error.stack
    });
  }
});

app.get('/auth/yahoo/callback', async (req, res) => {
  console.log('Entering /auth/yahoo/callback route');
  console.log('Full request query:', req.query);

  if (req.query.error) {
    console.error('OAuth error:', req.query.error);
    return res.status(400).send(`OAuth error: ${req.query.error}. Description: ${req.query.error_description}`);
  }

  if (!req.query.code) {
    console.error('No code provided in callback');
    return res.status(400).send('No code provided in callback.');
  }

  try {
    const tokenParams = {
      code: req.query.code,
      redirect_uri: process.env.YAHOO_REDIRECT_URI
    };
    console.log('Token params:', tokenParams);
    const accessToken = await client.getToken(tokenParams);
    console.log('Access Token received:', accessToken.token);
    
    // Store the token in session
    req.session.yahooToken = accessToken.token;

    // Use the token to initialize YahooFantasy
    yf.setUserToken(accessToken.token.access_token);
    
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ 
      error: 'Authentication failed', 
      details: error.message,
      stack: error.stack,
      query: req.query
    });
  }
});

app.get('/dashboard', (req, res) => {
  if (!req.session.yahooToken) {
    res.redirect('/auth/yahoo');
  } else {
    res.send('Authenticated! You can now make API calls. Try <a href="/test-api">Test API</a> or <a href="/myLeagues">My Leagues</a>');
  }
});

app.get('/test-api', async (req, res) => {
  if (!req.session.yahooToken) {
    res.redirect('/auth/yahoo');
  } else {
    try {
      yf.setUserToken(req.session.yahooToken.access_token);
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
  if (!req.session.yahooToken) {
    res.redirect('/auth/yahoo');
    return;
  }
  yf.setUserToken(req.session.yahooToken.access_token);
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
  if (!req.session.yahooToken) {
    res.redirect('/auth/yahoo');
    return;
  }
  yf.setUserToken(req.session.yahooToken.access_token);
  yf.team.roster(req.params.team_key, (err, data) => {
    if (err) {
      console.error('Error fetching team roster:', err);
      res.status(500).json({ error: 'Failed to fetch team roster', details: err.message });
    } else {
      res.json(data);
    }
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Error destroying session:', err);
    }
    res.redirect('/');
  });
});

// Error handling middleware
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