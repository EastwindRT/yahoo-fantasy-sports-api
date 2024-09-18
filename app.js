const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const YahooFantasy = require('yahoo-fantasy');
const { AuthorizationCode } = require('simple-oauth2');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Create session table if it doesn't exist
pool.query(`
  CREATE TABLE IF NOT EXISTS "session" (
    "sid" varchar NOT NULL COLLATE "default",
    "sess" json NOT NULL,
    "expire" timestamp(6) NOT NULL
  )
  WITH (OIDS=FALSE);
  ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
  CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
`).then(() => {
  console.log("Session table created or already exists.");
}).catch(err => {
  console.error("Error creating session table:", err);
});

// Logging environment variables (be careful not to log sensitive information in production)
console.log('YAHOO_APPLICATION_KEY:', process.env.YAHOO_APPLICATION_KEY ? 'Set' : 'Not set');
console.log('YAHOO_APPLICATION_SECRET:', process.env.YAHOO_APPLICATION_SECRET ? 'Set' : 'Not set');
console.log('YAHOO_REDIRECT_URI:', process.env.YAHOO_REDIRECT_URI);
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'Set' : 'Not set');

// Initialize YahooFantasy
const yf = new YahooFantasy(
  process.env.YAHOO_APPLICATION_KEY,
  process.env.YAHOO_APPLICATION_SECRET
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

// Session middleware with PostgreSQL store
app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'session'
  }),
  secret: process.env.SESSION_SECRET || 'your_session_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
}));

// Helper function to refresh token
async function refreshAccessToken(refreshToken) {
  try {
    const tokenResponse = await client.getToken({
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    });
    return tokenResponse.token;
  } catch (error) {
    console.error('Error refreshing access token:', error.message);
    throw error;
  }
}

// Middleware to check and refresh token if necessary
async function ensureToken(req, res, next) {
  console.log('Entering ensureToken middleware');
  if (!req.session.yahooToken) {
    console.log('No Yahoo token in session, redirecting to /auth/yahoo');
    return res.redirect('/auth/yahoo');
  }

  const now = Date.now();
  if (now >= req.session.yahooToken.expires_at - 60000) { // Refresh if within 1 minute of expiration
    console.log('Token expired or close to expiring, refreshing...');
    try {
      const newToken = await refreshAccessToken(req.session.yahooToken.refresh_token);
      req.session.yahooToken = newToken;
      yf.setUserToken(newToken.access_token);
      console.log('Token refreshed successfully');
    } catch (error) {
      console.error('Token refresh failed:', error);
      return res.redirect('/auth/yahoo');
    }
  } else {
    console.log('Token is still valid');
    yf.setUserToken(req.session.yahooToken.access_token);
  }

  next();
}

// Routes
app.get('/', (req, res) => {
  res.send('Yahoo Fantasy API app is running! <a href="/auth/yahoo">Authenticate with Yahoo</a>');
});

app.get('/auth/yahoo', (req, res) => {
  const authorizationUri = client.authorizeURL({
    redirect_uri: process.env.YAHOO_REDIRECT_URI,
    scope: 'openid fspt-r',
  });
  console.log('Generated authorization URI:', authorizationUri);
  res.redirect(authorizationUri);
});

app.get('/auth/yahoo/callback', async (req, res) => {
  console.log('Entering /auth/yahoo/callback route');
  console.log('Full request query:', req.query);
  console.log('Referer:', req.get('Referer'));

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

    console.log('Storing token in session');
    req.session.yahooToken = accessToken.token;

    console.log('Setting user token for YahooFantasy');
    yf.setUserToken(accessToken.token.access_token);

    console.log('Redirecting to dashboard');
    return res.redirect('/dashboard');
  } catch (error) {
    console.error('Authentication error:', error);
    if (error.data && error.data.payload) {
      console.error('Error payload:', error.data.payload);
    }
    if (!res.headersSent) {
      return res.status(500).json({ 
        error: 'Authentication failed', 
        details: error.message,
        stack: error.stack,
        query: req.query
      });
    }
  }
});

app.get('/dashboard', ensureToken, async (req, res) => {
  console.log('Entering /dashboard route');
  try {
    console.log('Fetching user data');
    const userData = await new Promise((resolve, reject) => {
      yf.user.games((err, data) => err ? reject(err) : resolve(data));
    });
    console.log('User data fetched successfully');

    const currentYear = new Date().getFullYear();
    const nflGame = userData.games.find(game => game.code === 'nfl' && game.season === currentYear.toString());

    let userLeagues = [];
    if (nflGame) {
      console.log('Fetching user leagues');
      userLeagues = await new Promise((resolve, reject) => {
        yf.user.game_leagues(nflGame.game_key, (err, data) => err ? reject(err) : resolve(data));
      });
      console.log('User leagues fetched successfully');
    }

    console.log('Rendering dashboard HTML');
    const dashboardHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Yahoo Fantasy Sports Dashboard</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; padding: 20px; max-width: 800px; margin: 0 auto; }
          h1, h2 { color: #333; }
          .section { margin-bottom: 30px; }
          .menu { list-style-type: none; padding: 0; }
          .menu li { margin-bottom: 10px; }
          .menu a, .button { display: inline-block; text-decoration: none; color: #fff; background-color: #0066cc; padding: 10px 15px; border-radius: 5px; }
          .menu a:hover, .button:hover { background-color: #0056b3; }
          .leagues { list-style-type: none; padding: 0; }
          .leagues li { margin-bottom: 15px; background-color: #f0f0f0; padding: 10px; border-radius: 5px; }
        </style>
      </head>
      <body>
        <h1>Welcome to Your Yahoo Fantasy Sports Dashboard</h1>

        <div class="section">
          <h2>Quick Actions</h2>
          <ul class="menu">
            <li><a href="/myLeagues">View All My Leagues</a></li>
            <li><a href="/user-info">View User Information</a></li>
            <li><a href="/logout">Logout</a></li>
          </ul>
        </div>

        <div class="section">
          <h2>Your NFL Leagues for ${currentYear}</h2>
          ${nflGame ? `
            <ul class="leagues">
              ${userLeagues.games[0].leagues.map(league => `
                <li>
                  <strong>${league.name}</strong> (${league.num_teams} teams)
                  <br>
                  Draft Status: ${league.draft_status}
                  <br>
                  <a href="/league/${league.league_key}" class="button">View League</a>
                </li>
              `).join('')}
            </ul>
          ` : `<p>No NFL leagues found for the current year.</p>`}
        </div>

        <div class="section">
          <h2>Available Games</h2>
          <ul class="leagues">
            ${userData.games.map(game => `
              <li>
                <strong>${game.name}</strong> (${game.season})
                <br>
                Status: ${game.is_game_over ? 'Game Over' : game.is_offseason ? 'Offseason' : 'Active'}
              </li>
            `).join('')}
          </ul>
        </div>
      </body>
      </html>
    `;

    console.log('Sending dashboard HTML');
    res.send(dashboardHtml);
  } catch (error) {
    console.error('Error in /dashboard route:', error);
    res.status(500).send('Error loading dashboard. Please try again later.');
  }
});

app.get('/direct-dashboard', (req, res) => {
  console.log('Serving direct dashboard HTML');
  const dashboardHtml = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Direct Dashboard</title>
    </head>
    <body>
      <h1>This is a direct dashboard page</h1>
      <p>If you can see this, HTML serving is working correctly.</p>
    </body>
    </html>
  `;
  res.send(dashboardHtml);
});

app.get('/myLeagues', ensureToken, async (req, res) => {
  console.log('Entering /myLeagues route');
  try {
    console.log('Fetching user games');
    const userData = await new Promise((resolve, reject) => {
      yf.user.games((err, data) => err ? reject(err) : resolve(data));
    });

    console.log('Fetching leagues for each game');
    const leagues = await Promise.all(userData.games.map(async game => {
      const gameLeagues = await new Promise((resolve, reject) => {
        yf.user.game_leagues(game.game_key, (err, data) => err ? reject(err) : resolve(data));
      });
      return {
        game: game,
        leagues: gameLeagues.games[0].leagues
      };
    }));

    res.json(leagues);
  } catch (error) {
    console.error('Error fetching leagues:', error);
    res.status(500).json({ error: 'Failed to fetch leagues', details: error.message });
  }
});

app.get('/league/:league_key', ensureToken, async (req, res) => {
  console.log(`Entering /league/${req.params.league_key} route`);
  try {
    const leagueKey = req.params.league_key;

    console.log(`Fetching league meta for ${leagueKey}`);
    const leagueData = await new Promise((resolve, reject) => {
      yf.league.meta(leagueKey, (err, data) => err ? reject(err) : resolve(data));
    });

    console.log(`Fetching standings for ${leagueKey}`);
    const standingsData = await new Promise((resolve, reject) => {
      yf.league.standings(leagueKey, (err, data) => err ? reject(err) : resolve(data));
    });

    res.json({ 
      league: leagueData,
      standings: standingsData.standings
    });
  } catch (error) {
    console.error('Error fetching league details:', error);
    res.status(500).json({ error: 'Failed to fetch league details', details: error.message });
  }
});

app.get('/user-info', ensureToken, async (req, res) => {
  console.log('Entering /user-info route');
  try {
    console.log('Fetching user information');
    const userData = await new Promise((resolve, reject) => {
      yf.user.games((err, data) => err ? reject(err) : resolve(data));
    });
    res.json(userData);
  } catch (error) {
    console.error('Error fetching user information:', error);
    res.status(500).json({ error: 'Failed to fetch user information', details: error.message });
  }
});

app.get('/logout', (req, res) => {
  console.log('Logging out user');
  req.session.destroy(err => {
    if (err) {
      console.error('Error destroying session:', err);
    }
    res.redirect('/');
  });
});

app.get('/debug', (req, res) => {
  console.log('Entering /debug route');
  res.json({
    session: {
      exists: !!req.session,
      yahooToken: req.session.yahooToken ? {
        exists: true,
        expiresAt: req.session.yahooToken.expires_at,
        isValid: new Date(req.session.yahooToken.expires_at) > new Date()
      } : null
    },
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      YAHOO_REDIRECT_URI: process.env.YAHOO_REDIRECT_URI,
      DATABASE_URL: process.env.DATABASE_URL ? 'Set' : 'Not set',
      YAHOO_APPLICATION_KEY: process.env.YAHOO_APPLICATION_KEY ? 'Set' : 'Not set',
      YAHOO_APPLICATION_SECRET: process.env.YAHOO_APPLICATION_SECRET ? 'Set' : 'Not set'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? '🥞' : err.stack
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Global error handler for unhandled promises
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // In a production environment, you might want to do some cleanup and restart the server
  // process.exit(1);
});