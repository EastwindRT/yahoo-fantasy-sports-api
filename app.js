const express = require('express');
const YahooFantasy = require('yahoo-fantasy');
const { AuthorizationCode } = require('simple-oauth2');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

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

const redirectUri = process.env.YAHOO_REDIRECT_URI;

// Token refresh mechanism
const refreshToken = async () => {
  try {
    console.log('Refreshing token');
    const accessToken = await client.getToken({
      refresh_token: global.yahooToken.refresh_token,
      grant_type: 'refresh_token'
    });
    global.yahooToken = accessToken.token;
    yf.setUserToken(accessToken.token.access_token);
    console.log('Token refreshed successfully');
  } catch (error) {
    console.error('Error refreshing token:', error);
    throw error;
  }
};

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/auth/yahoo', (req, res) => {
  try {
    const authorizationUri = client.authorizeURL({
      redirect_uri: redirectUri,
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
    console.error('Error description:', req.query.error_description);
    return res.status(400).json({ error: req.query.error, description: req.query.error_description });
  }

  if (!req.query.code) {
    console.error('No code provided in callback');
    return res.status(400).json({ error: 'No code provided in callback', query: req.query });
  }

  try {
    const tokenParams = {
      code: req.query.code,
      redirect_uri: redirectUri
    };
    console.log('Token params:', tokenParams);
    const accessToken = await client.getToken(tokenParams);
    console.log('Access Token received:', accessToken.token);

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
      stack: error.stack,
      query: req.query
    });
  }
});

app.get('/dashboard', (req, res) => {
  if (!global.yahooToken) {
    res.redirect('/auth/yahoo');
  } else {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
  }
});

app.get('/check-auth', (req, res) => {
  if (global.yahooToken) {
    res.json({ authenticated: true });
  } else {
    res.json({ authenticated: false });
  }
});

app.get('/my-leagues', async (req, res) => {
  console.log('Entering /my-leagues route');
  if (!global.yahooToken) {
    console.log('No Yahoo token found');
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    if (global.yahooToken.expires_at && Date.now() >= global.yahooToken.expires_at) {
      console.log('Token expired, refreshing');
      await refreshToken();
    }

    console.log('Fetching user games');
    const userData = await new Promise((resolve, reject) => {
      yf.user.games(
        (err, data) => {
          if (err) {
            console.error('Error fetching user games:', err);
            reject(err);
          } else {
            console.log('User games fetched successfully');
            resolve(data);
          }
        }
      );
    });

    console.log('User data:', userData);

    const nbaGame = userData.games.find(game => game.code === 'nba');

    if (!nbaGame) {
      console.log('No NBA game found for user');
      return res.status(404).json({ error: 'No NBA game found for this user.' });
    }

    console.log('NBA game found:', nbaGame);

    console.log('Fetching user leagues');
    const leaguesData = await new Promise((resolve, reject) => {
      yf.user.game_leagues(
        nbaGame.game_key,
        (err, data) => {
          if (err) {
            console.error('Error fetching user leagues:', err);
            reject(err);
          } else {
            console.log('User leagues fetched successfully');
            resolve(data);
          }
        }
      );
    });

    console.log('Leagues data:', leaguesData);

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

    console.log('Sending response');
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

app.get('/league/:league_key', async (req, res) => {
  console.log('Entering /league/:league_key route');
  if (!global.yahooToken) {
    console.log('No Yahoo token found');
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    if (global.yahooToken.expires_at && Date.now() >= global.yahooToken.expires_at) {
      console.log('Token expired, refreshing');
      await refreshToken();
    }

    const leagueKey = req.params.league_key;
    console.log('Fetching league data for:', leagueKey);
    const leagueData = await new Promise((resolve, reject) => {
      yf.league.meta(
        leagueKey,
        (err, data) => {
          if (err) {
            console.error('Error fetching league meta:', err);
            reject(err);
          } else {
            console.log('League meta fetched successfully');
            resolve(data);
          }
        }
      );
    });

    console.log('Fetching league standings');
    const standingsData = await new Promise((resolve, reject) => {
      yf.league.standings(
        leagueKey,
        (err, data) => {
          if (err) {
            console.error('Error fetching league standings:', err);
            reject(err);
          } else {
            console.log('League standings fetched successfully');
            resolve(data);
          }
        }
      );
    });

    console.log('Sending response');
    res.json({ 
      league: leagueData,
      standings: standingsData.standings
    });
  } catch (error) {
    console.error('Error fetching league details:', error);
    res.status(500).json({ error: 'Failed to fetch league details', details: error.message });
  }
});

// Test route
app.get('/test', (req, res) => {
  res.json({ message: 'Server is running' });
});

// Debug route to check environment variables
app.get('/debug', (req, res) => {
  res.json({
    YAHOO_APPLICATION_KEY: process.env.YAHOO_APPLICATION_KEY ? 'Set' : 'Not set',
    YAHOO_APPLICATION_SECRET: process.env.YAHOO_APPLICATION_SECRET ? 'Set' : 'Not set',
    YAHOO_REDIRECT_URI: process.env.YAHOO_REDIRECT_URI,
    PORT: process.env.PORT || 3000
  });
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