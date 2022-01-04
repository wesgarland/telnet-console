/**
 * @file        telnet-console.js
 *              Main library for the Telnet Console
 * @author      Wes Garland, wes@kingsds.network
 * @date        June 2021
 */
exports.start = require('./lib/tc-repl').start;
exports.ConsoleInterceptor = require('./lib/intercept-console').ConsoleInterceptor;
