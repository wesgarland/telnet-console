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
const underlyingConsole = Object.assign({}, consoleModule);

function RingBuffer(size)
{
  this.size = size;
  this.clear();
}

RingBuffer.prototype.push = function RingBuffer$$push(el)
{
  this.buf[this.next] = el;
  this.next = (this.next + 1) % this.size;
}

RingBuffer.prototype.clear = function RingBuffer$$clear()
{
  this.buf = [];
  this.next = 0;
}

for (let method of ['forEach', 'map', 'filter', 'find', 'slice'])
{
  RingBuffer.prototype[method] = function RingBuffer$$autoMethod()
  {
    var top    = this.buf.slice(this.next);
    var bottom = this.buf.slice(0, this.next);
    var tmp = top.concat(bottom);

    return tmp[method].apply(tmp, arguments);
  }
}

/* Similar to util.inspect, but does not quote strings */
function inspector(el, options)
{
  if (typeof el === 'string' || el instanceof String)
    return util.formatWithOptions(options, '%s', el);
  
  return util.inspect(el, options);
}

/**
 * @constructor
 * Instantiate a new console interceptor. Works by modifying the exports of the console
 * object and the current global console symbol. It is plausible that multiple interceptors
 * could co-exist in the right environment.
 *
 * Each instance of ConsoleInterceptor is an EventEmitter which emits one event per console.log (etc)
 * call. The event handler is passed object which has the following properties:
 * - inspectedArguments: the arguments as rendered by util::inspect()
 * - arguments:          the actual arguments array passed to the intercepted function
 * - level:              the log level of the original message
 * - date:               an instance of Date which 
 *
 * Each instance of ConsoleInterceptor exposes the following API:
 * - buffer             an instance of RingBuffer which stores the event arguments corresponding to the
 *                      most recently intercepted messages
 * - buffer.forEach()   like Array.forEach()
 * - buffer.filter()    like Array.filter()
 * - buffer.find()      like Array.find()
 * - buffer.slice()     like Array.slice()
 * - buffer.map()       like Array.map()
 * - buffer.clear()     clear the current contents of the buffer
 * - trace              emits trace event, see console::trace() for details
 * 
 * @param {object} options      various options for controlling the interceptor, including
 *                              - levels:       an array of log levels to intercept
 *                              - minimal:      true to skip building the inspectedArguments
 *                                              and date properties of the event object
 *                              - keep:         number log arguments to keep in the ring buffer
 */
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

  this.buffer = new RingBuffer(options.keep);
  this.levels = options.levels;
  
  function wrapperFactory(level)
  {
    function consoleWrapper()
    {
      var details; /* event handler argument */

      try
      {
        details = {
          level,
          arguments
        };

        if (!options.minimal)
        {
          details.inspectedArguments = Array.from(arguments).map(el => inspector(el, options.inspect));
          details.date = new Date();
        }
        that.buffer.push(details);
        that.emit(level, details);
      }
      catch(e)
      {
        underlyingConsole.error('Uncaught Error in consoleWrapper', e);
      }
      
      return underlyingConsole[level].apply(null, arguments);
    }
    consoleWrapper.level = level;
    return consoleWrapper;
  }

  for (let level of this.levels)
  {
    this[level] = console[level] = consoleModule[level] = wrapperFactory(level);
  }

  function traceWrapper()
  {
    var details = {date: new Date(), level: 'trace'};
    var 

    details = {
      level: 'trace',
      arguments
    };

    if (!options.minimal)
    {
      details.inspectedArguments = [`Trace: ${inspectedArguments.join(' ')}\n` + new Error().stack.split('\n').slice(1)];
      details.date = new Date();
    }

    that.buffer.push(details);
    that.emit('trace', details);
    underlyingConsole.trace.apply(null, arguments);
  }

  this.trace = console.trace = consoleModule.trace = traceWrapper;
}

exports.ConsoleInterceptor.prototype = new (require('events').EventEmitter)();
exports.ConsoleInterceptor.prototype.underlyingEmit = exports.ConsoleInterceptor.prototype.emit;

/**
 * A version of EventEmitter::emit that doesn't throw when you try to emit error events
 * which there are not listeners, and emits every event to the 'any' listener.
 */
exports.ConsoleInterceptor.prototype.emit = function ConsoleIntercept$$emit(eventName, ev)
{
  var retval;

  if (this.listeners(eventName).length !== 0)
    retval = this.underlyingEmit.call(this, eventName, ev);

  this.underlyingEmit('any', ev);

  return retval || false;
}

/**
 * re-establish a console interception that has been interrupted, presumably by another console
 * interceptor that doesn't ever invoke the underlying ("real") console code [that we intercepted]. This
 * also causes us to re-evaluate what we think of as the underlying console implementation, so that we
 * don't break whatever broke us.
 */
exports.ConsoleInterceptor.prototype.reintercept = function ConsoleIntercept$$reintercept()
{
  for (let prop of this.levels.concat(['trace']))
  {
    if (console[prop] === this[prop])
      continue;
    underlyingConsole[prop] = console[prop];
    console[prop] = consoleModule[prop] = this[prop];
  }
}
