#! /usr/bin/env node
/**
 * @file        daemon.js
 *              An example daemon which shows to use and test nrc
 * @author      Wes Garland, wes@kingsds.network
 * @date        Jun 2021
 */
const nrc = require('../nrc');

setInterval(() => console.log(`something ${Math.random().toString(36).slice(2).slice(-5)} happened at`, new Date()), 3000);

var hnd = nrc.start({
  port: 2323
});

var ci = new nrc.ConsoleInterceptor();
ci.on('', () => { debugger; console.log('world')});

process.on('uncaughtException', (error) => console.error('UNCAUGHT EXCEPTION:', error));
process.on('unhandledRejection', (error) => console.error('UNHANDLED REJECTION:', error));
