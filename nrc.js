/**
 * @file	nrc.js
 *		Main library for the Node Runtime Console
 * @author	Wes Garland, wes@kingsds.network
 * @date	June 2021
 */
exports.start = require('./lib/nrc-repl').start;
exports.ConsoleInterceptor = require('./lib/intercept-console').ConsoleInterceptor;
