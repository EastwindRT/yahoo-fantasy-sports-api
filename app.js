const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Sequelize, DataTypes } = require('sequelize');
const YahooFantasy = require('yahoo-fantasy');
const { AuthorizationCode } = require('simple-oauth2');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Database setup
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  }
});

// Define User model
const User = sequelize.define('User', {
  yahooId: {
    type: DataTypes.STRING,
    unique: true
  },
  accessToken: DataTypes.TEXT,
  refreshToken: DataTypes.TEXT,
  tokenExpiry: DataTypes.DATE
});

// Sync database
sequelize.sync();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware with PostgreSQL store
app.use(session({
  store: new pgSession({
    conObject: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    }
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
}));

// Yahoo OAuth setup
const client = new AuthorizationCode({
  client: {
    id: process.env.YAHOO_CLIENT_ID,
    secret: process.env.YAHOO_CLIENT_SECRET
  },
  auth: {
    tokenHost: 'https://api.login.yahoo.com',
    authorizePath: '/oauth2/request_auth',
    tokenPath: '/oauth2/get_token'
  }
});

const redirectUri = process.env.YAHOO_REDIRECT_URI;

// Initialize YahooFantasy
const yf = new YahooFantasy(
  process.env.YAHOO_CLIENT_ID,
  process.env.YAHOO_CLIENT_SECRET
);

// Middleware to check if user is authenticated
const isAuthenticated = async (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect('/auth/yahoo');
  }
  const user = await User.findByPk(req.session.userId);
  if (!user) {
    return res.redirect('/auth/yahoo');
  }
  if (new Date() > new Date(user.tokenExpiry)) {
    try {
      const refreshedTokens = await client.getToken({
        refresh_token: user.refreshToken,
        grant_type: 'refresh_token'
      });
      await user.update({
        accessToken: refreshedTokens.token.access_token,
        refreshToken: refreshedTokens.token.refresh_token,
        tokenExpiry: new Date(refreshedTokens.token.expires_at)
      });
    } catch (error) {
      console.error('Token refresh failed:', error);
      return res.redirect('/auth/yahoo');
    }
  }
  req.user = user;
  next();
};

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/auth/yahoo', (req, res) => {
  const authorizationUri = client.authorizeURL({
    redirect_uri: redirectUri,
    scope: 'openid fspt-r',
  });
  console.log('Redirecting to Yahoo authorization URL:', authorizationUri);
  res.redirect(authorizationUri);
});

app.get('/auth/yahoo/callback', async (req, res) => {
  try {
    const { code } = req.query;
    console.log('Received auth code:', code);

    const tokenResponse = await client.getToken({
      code,
      redirect_uri: redirectUri
    });
    console.log('Token response received:', JSON.stringify(tokenResponse, null, 2));

    const yahooId = tokenResponse.token.id_token; // You might need to decode this to get the actual Yahoo ID
    console.log('Yahoo ID:', yahooId);

    let user = await User.findOne({ where: { yahooId } });
    if (!user) {
      console.log('Creating new user');
      user = await User.create({
        yahooId,
        accessToken: tokenResponse.token.access_token,
        refreshToken: tokenResponse.token.refresh_token,
        tokenExpiry: new Date(tokenResponse.token.expires_at)
      });
    } else {
      console.log('Updating existing user');
      await user.update({
        accessToken: tokenResponse.token.access_token,
        refreshToken: tokenResponse.token.refresh_token,
        tokenExpiry: new Date(tokenResponse.token.expires_at)
      });
    }
    req.session.userId = user.id;
    console.log('User authenticated, redirecting to dashboard');
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Detailed error in auth callback:', error);
    console.error('Error stack:', error.stack);
    res.status(500).send('Authentication failed. Please try again.');
  }
});

app.get('/dashboard', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/api/user', isAuthenticated, async (req, res) => {
  try {
    yf.setUserToken(req.user.accessToken);
    const userData = await new Promise((resolve, reject) => {
      yf.user.games((err, data) => err ? reject(err) : resolve(data));
    });
    res.json(userData);
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

app.get('/api/my-leagues/:year', isAuthenticated, async (req, res) => {
  try {
    yf.setUserToken(req.user.accessToken);
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

app.get('/api/league/:league_key', isAuthenticated, async (req, res) => {
  try {
    yf.setUserToken(req.user.accessToken);
    const leagueKey = req.params.league_key;

    const leagueData = await new Promise((resolve, reject) => {
      yf.league.meta(leagueKey, (err, data) => err ? reject(err) : resolve(data));
    });

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
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});