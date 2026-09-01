'use strict';
// Build the fixture snapshot once before the browser tests start.
const { buildFixtureSite } = require('./build-fixture-site');

module.exports = async () => {
  const dir = await buildFixtureSite();
  console.log(`[e2e] fixture snapshot built at ${dir}`);
};
