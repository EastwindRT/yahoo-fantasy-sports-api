// app.js
const YahooFantasy = require('./index.js');

const yf = new YahooFantasy(
  process.env.YAHOO_APPLICATION_KEY,
  process.env.YAHOO_APPLICATION_SECRET
);

// Example: Fetch NBA game metadata
function fetchNBAMetadata() {
  return new Promise((resolve, reject) => {
    yf.game.meta('nba', (err, data) => {
      if (err) {
        console.log("Error fetching NBA game metadata:", err);
        reject(err);
      } else {
        console.log("NBA game metadata:", data);
        resolve(data);
      }
    });
  });
}

// Example: Fetch NBA players
function fetchPlayerStats() {
  return new Promise((resolve, reject) => {
    yf.player.stats(
      ['nba.p.3704'], // Player key for LeBron James
      (err, data) => {
        if (err) {
          console.log("Error fetching player stats:", err);
          reject(err);
        } else {
          console.log("Player stats:", data);
          resolve(data);
        }
      }
    );
  });
}

// Run the queries
async function runQueries() {
  try {
    // Authenticate first
    await new Promise((resolve, reject) => {
      yf.auth((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    console.log("Authentication successful");

    await fetchNBAMetadata();
    console.log("NBA metadata fetched successfully");

    await fetchPlayerStats();
    console.log("Player stats fetched successfully");

    // TODO: Add league settings query when you have a league key
    // TODO: Add transactions query when you have a league key
  } catch (error) {
    console.error("Error running queries:", error);
  }
}

runQueries();