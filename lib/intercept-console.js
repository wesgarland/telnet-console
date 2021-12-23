/**
 * @file        intercept-console.js
 *
 *              Library code for intercepting the global console object,
 *              works by making the functions emit events in addition to
 *              their usual functionality.
 *
 * @author      Wes Garland, wes@kingsds.network
 * @date        June 2021
 */
'use strict';

const util = require('util');
const consoleModule = require('console');
const realConsole = Object.assign({}, consoleModule);

function RingBuffer(size)
{
  this.buf = [];
  this.next = 0;
  this.size = size;
}

RingBuffer.prototype.push = function RingBuffer$$push(el)
{
  this.buf[this.next] = el;
  this.next = (this.next + 1) % this.size;
}

RingBuffer.prototype.join = function RingBuffer$$join(e)
{
  var top = this.buf.slice(this.next);
  var bottom = this.buf.slice(0, this.next);
  var tmp = top.concat(bottom);

  return tmp.join.apply(tmp, arguments);
}

/* Similar to util.inspect, but does not quote strings */
function inspector(el, options)
{
  if (typeof el === 'string' || el instanceof String)
    return util.formatWithOptions(options, '%s', el);
  
  return util.inspect(el, options.inspect);
}

exports.ConsoleInterceptor = function ConsoleInterceptor(options)
{
  const that = this;

  options = Object.assign({
    keep:    100,
    levels:  [ 'debug', 'log', 'info', 'warn', 'error' ],
    inspect: {
      colors:             require('tty').isatty(0) || process.env.FORCE_COLOR,
      breakLength:        process.stdout.columns || Number(process.env.COLUMNS) || 80,
      showHidden:         true,
      depth:              Infinity,
      maxArrayLength:     Infinity,
      maxStringLength:    Infinity,
    }
  }, options);

  that.buffer = new RingBuffer(options.keep);
  
  function wrapperFactory(realFun, level)
  {
    var level = 0;

    function consoleWrapper()
    {
      var inspectedArguments, details;

      try
      {
        inspectedArguments = Array.from(arguments).map(el => inspector(el, options.inspect));
        details = {date: new Date(), level, inspectedArguments};
        that.buffer.push(details);
        that.emit(level, details);
        that.emit('any', details);
      }
      catch(e)
      {
        realConsole.error('Uncaught Error in consoleWrapper', e);
      }
      
      return realFun.apply(null, arguments);
    }
    consoleWrapper.level = level;
    return consoleWrapper;
  }

  for (let level of options.levels)
  {
    this[level] = console[level] = consoleModule[level] = wrapperFactory(console[level], level);
  }

  function traceWrapper()
  {
    var details = {date: new Date(), level: 'trace'};
    var inspectedArguments = Array.from(arguments).map(el => inspector(el, options.inspect));
    
    details.inspectedArguments = [`Trace: ${inspectedArguments.join(' ')}\n` + new Error().stack.split('\n').slice(1)];
    this.buffer.push(details);
    this.emit('trace', details);
    this.emit('any', details);
    realConsole.trace.apply(null, arguments);
  }

  this.trace = console.trace = consoleModule.trace = traceWrapper;
}

exports.ConsoleInterceptor.prototype = new (require('events').EventEmitter)();
