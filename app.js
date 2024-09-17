const express = require('express');
const YahooFantasy = require('yahoo-fantasy');
const { AuthorizationCode } = require('simple-oauth2');
const session = require('express-session');
const dotenv = require('dotenv');
const path = require('path');
const crypto = require('crypto');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your_session_secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

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

const redirectUri = process.env.YAHOO_REDIRECT_URI;

// Middleware to check if the user is authenticated
const isAuthenticated = (req, res, next) => {
  if (req.session.yahooToken) {
    next();
  } else {
    res.redirect('/auth/yahoo');
  }
};

// Routes
app.get('/', (req, res) => {
  if (req.session.yahooToken) {
    res.redirect('/dashboard');
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

app.get('/auth/yahoo', (req, res) => {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;

    const authorizationUri = client.authorizeURL({
      redirect_uri: redirectUri,
      scope: 'openid fspt-r',
      state: state
    });
    res.redirect(authorizationUri);
  } catch (error) {
    console.error('Error generating authorization URL:', error);
    res.status(500).json({ 
      error: 'Failed to generate authorization URL', 
      details: error.message
    });
  }
});

app.get('/auth/yahoo/callback', async (req, res) => {
  if (req.query.error) {
    return res.status(400).json({ error: req.query.error, description: req.query.error_description });
  }

  if (!req.query.code) {
    return res.status(400).json({ error: 'No code provided in callback' });
  }

  if (req.query.state !== req.session.oauthState) {
    return res.status(400).json({ error: 'Invalid state parameter' });
  }

  try {
    const tokenParams = {
      code: req.query.code,
      redirect_uri: redirectUri
    };
    const accessToken = await client.getToken(tokenParams);

    req.session.yahooToken = accessToken.token;
    yf.setUserToken(accessToken.token.access_token);

    res.redirect('/dashboard');
  } catch (error) {
    console.error('Authentication error:', error);

    if (error.data && error.data.payload && error.data.payload.error === 'invalid_grant' &&
        error.data.payload.error_description === 'Authorization code expired') {
      console.log('Authorization code expired, redirecting to auth page');
      return res.redirect('/auth/yahoo');
    }

    res.status(500).json({ 
      error: 'Authentication failed', 
      details: error.message
    });
  }
});

app.get('/dashboard', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Error destroying session:', err);
    }
    res.redirect('/');
  });
});

app.get('/available-years', isAuthenticated, async (req, res) => {
  try {
    const userData = await new Promise((resolve, reject) => {
      yf.user.games((err, data) => err ? reject(err) : resolve(data));
    });

    const nbaYears = userData.games
      .filter(game => game.code === 'nba')
      .map(game => game.season)
      .sort((a, b) => b - a);  // Sort in descending order

    res.json({ years: nbaYears });
  } catch (error) {
    console.error('Error fetching available years:', error);
    res.status(500).json({ error: 'Failed to fetch available years', details: error.message });
  }
});

app.get('/my-leagues/:year', isAuthenticated, async (req, res) => {
  try {
    if (req.session.yahooToken.expires_at && Date.now() >= req.session.yahooToken.expires_at) {
      // Token refresh logic would go here
      console.log('Token expired, refresh logic needed');
    }

    yf.setUserToken(req.session.yahooToken.access_token);

    const userData = await new Promise((resolve, reject) => {
      yf.user.games((err, data) => err ? reject(err) : resolve(data));
    });

    const nbaGame = userData.games.find(game => game.code === 'nba' && game.season === req.params.year);

    if (!nbaGame) {
      return res.status(404).json({ error: `No NBA game found for year ${req.params.year}` });
    }

    const leaguesData = await new Promise((resolve, reject) => {
      yf.user.game_leagues(nbaGame.game_key, (err, data) => err ? reject(err) : resolve(data));
    });

    const leagues = leaguesData.games[0].leagues.map(league => ({
      name: league.name,
      league_id: league.league_id,
      league_key: league.league_key,
      num_teams: league.num_teams,
      draft_status: league.draft_status,
      start_date: league.start_date,
      end_date: league.end_date,
      url: league.url,
      scoring_type: league.scoring_type,
      league_type: league.league_type,
      renew: league.renew,
      short_invitation_url: league.short_invitation_url,
      is_pro_league: league.is_pro_league,
      current_week: league.current_week
    }));

    res.json({ 
      leagues,
      user: {
        guid: userData.guid
      },
      game: {
        name: nbaGame.name,
        season: nbaGame.season,
        is_game_over: nbaGame.is_game_over,
        is_offseason: nbaGame.is_offseason
      }
    });
  } catch (error) {
    console.error('Error in /my-leagues:', error);
    res.status(500).json({ error: 'Failed to fetch league data', details: error.message });
  }
});

app.get('/league/:league_key', isAuthenticated, async (req, res) => {
  try {
    if (req.session.yahooToken.expires_at && Date.now() >= req.session.yahooToken.expires_at) {
      // Token refresh logic would go here
      console.log('Token expired, refresh logic needed');
    }

    yf.setUserToken(req.session.yahooToken.access_token);

    const leagueKey = req.params.league_key;
    const leagueData = await new Promise((resolve, reject) => {
      yf.league.meta(leagueKey, (err, data) => err ? reject(err) : resolve(data));
    });

    const standingsData = await new Promise((resolve, reject) => {
      yf.league.standings(leagueKey, (err, data) => err ? reject(err) : resolve(data));
    });

    if (!standingsData || !standingsData.standings) {
      throw new Error('No standings data available');
    }

    res.json({ 
      league: leagueData,
      standings: standingsData.standings
    });
  } catch (error) {
    console.error('Error fetching league details:', error);
    res.status(500).json({ error: 'Failed to fetch league details', details: error.message });
  }
});

// Implement a simple keep-alive route
app.get('/keep-alive', (req, res) => {
  res.status(200).send('OK');
});

// Test route
app.get('/test', (req, res) => {
  res.json({ message: 'Server is running' });
});

// Custom error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong', message: err.message });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});