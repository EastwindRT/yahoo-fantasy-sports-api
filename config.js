require('dotenv').config();

const config = {
  yahooClientId: process.env.YAHOO_CLIENT_ID,
  yahooClientSecret: process.env.YAHOO_CLIENT_SECRET,
  yahooRedirectUri: process.env.YAHOO_REDIRECT_URI,
  databaseUrl: process.env.DATABASE_URL,
  sessionSecret: process.env.SESSION_SECRET,
  nodeEnv: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 3000
};

console.log('Configuration loaded:', {
  ...config,
  yahooClientSecret: config.yahooClientSecret ? '[REDACTED]' : 'Not set',
  databaseUrl: config.databaseUrl ? '[REDACTED]' : 'Not set',
  sessionSecret: config.sessionSecret ? '[REDACTED]' : 'Not set'
});

module.exports = config;