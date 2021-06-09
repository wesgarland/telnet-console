#! /usr/bin/env node
/**
 * @file        daemon.js
 *              An example daemon which shows to use and test nrc
 * @author      Wes Garland, wes@kingsds.network
 * @date        Jun 2021
 */
const nrc = require('../nrc');

setInterval(() => console.log('something happened at', new Date()), 1000);

var hnd = nrc.start({
  port: 2323
});

var ci = new nrc.ConsoleInterceptor();
ci.on('', () => { debugger; console.log('world')});
