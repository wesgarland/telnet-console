/**
 * @file        tc-repl.js - REPL startup code for the Telnet Console.
 *              
 * This library supports both stdio and telnetd runtime consoles. 
 * Invocation from within the main program allows evaluation of variables global to 
 * the main program:
 *
 * require('telnet-console').start(options, function tcEval() { return eval(arguments[0]) });
 *
 *
 * Note: this library exists as a singleton.
 *
 * @author      Wes Garland, wes@kingsds.network
 * @date        Sep 2020, Jun 2021
 */
'use strict';

const telnet = require('telnet');
const process = require('process');
const os = require('os');
const path = require('path');
const { humanFriendlyTimeInterval } = require('./human-friendly-time-interval');
const { leafMerge } = require('./leaf-merge');
const { expandPath } = require('./expand-path');
const debug = Boolean((process.env.DEBUG || '').indexOf('telnet') !== -1);

const registry = [];

var help, commands;

/** 
 * Start the REPL(s)
 * @param       {object}        options                 configuration options for configuring telnetd, 
 *                                                      the repl, etc. Options include:
 *                                                      - port:         tcp port to listen on or false
 *                                                      - eval:         eval-like function that is used
 *                                                                      to evaluate REPL commands in the 
 *                                                                      desired scope
 *                                                      - prompt:       REPL prompt string
 *                                                      - stdio:        if true, start a repl on stdio
 *
 * @param       {object}        replHelpers...          One or more objects with two properties, 'commands' and 'help', where
 *                                                      - commands is an Object with key,value pairs of command,function of extra commands to add to the REPL
 *                                                      - help is an Object with key,value pairs of command,text of help for extra commands
 */
exports.start = function tc$$start(options, ...replHelpers)
{
  options = leafMerge({
    port:            2323,
    stdio:           false,
    eval:            /* indirect */ eval,
    prompt:          '> ',
    useColors:       true,
    ignoreUndefined: true,
    useGlobal:       true,
    terminal:        true,
    callbackTelnet:  false,
    callbackStdio:   false,
    bufferLines:     1000
  }, options);

  const ci = new (require('./intercept-console').ConsoleInterceptor)({ inspect: { colors: true }, keep: options.bufferLines});
  
  if (options.port)
  {
    const server = telnet.createServer((client) => handleNewClient(client, ci, options)).listen(options.port);
    if (options.callbackTelnet)
      options.callbackTelnet(options.port, server, registry);
  }

  help     = Object.assign({}, defaultHelp);
  commands = Object.assign({}, defaultCommands);
  for (let el of replHelpers)
  {
    Object.assign(help,     el.help);
    Object.assign(commands, el.commands);
  }
  if (!commands.help)
    commands.help = (args) => args ? help[args] : Object.keys(leafMerge({}, commands, help));

  /* Start a REPL on stdio if it's a terminal */
  if (process.stdin.isTTY
      && options.stdio === true
      && !(require('module')._cache.niim instanceof require('module').Module))
  {
    let stdioRepl =  require('repl').start(leafMerge(options, { eval: evalWrapperFactory(options) } ));

    if (options.histfile && stdioRepl.setupHistory)
      stdioRepl.setupHistory(expandPath(options.histfile), () => {});

    stdioRepl.on('exit', () => console.log('REPL exit'));
    if (options.callbackStdio)
      options.callbackStdio();
  }
}


/** 
 * Write a captured log entry to the given client.
 */
function writeLogEntry(client, entry)
{
  try
  {
    for (let i = 0; i < entry.inspectedArguments.length; i++)
    {
      /* prefer low memory footprint over fast i/o... (help me Nagle Timer, you're my only hope) */
      if (i)
        client.output.write(' ');
      client.output.write(entry.inspectedArguments[i].replace(/([^\r])\n/g, "$1\r\n"));
    }
    client.output.write('\r\n');

    /*
     *  let argv = Array.from(entry.arguments);
     *  argv.push('\r');
     *  console[entry.level].apply(null, argv);
     */
  }
  catch(error)
  {
    /* warning - using console here could trigger infinite recursion */;
    if (error.code !== 'ENOENT' && error.code !== 'ERR_STREAM_WRITE_AFTER_END')
      throw error;
  }
}

/**
 * Handle a new client.
 *
 * @param {object}      connection      the connection handle (implementation detail:
 *                                      we rely on this being the output socket)
 * @param {object}      ci              console-interceptor handle
 * @param {registry}    registry        per-server registry which contains known clients
 */
function handleNewClient(client, ci, options)
{
  /* Disabled in favour of manual inspection until we can figure out how
   * to make the built-in console methods go through client.write(?) properly,
   * so that LF can be transformed to CRLF
   *
   *  const console = new require('console').Console({
   *    stdin:  client.output,
   *    stdout: client.output,
   *    colorMode: true,
   *  });
   */
  function handleConsoleEvents(ev)
  {
    if (client.logOff)
      return;
    writeLogEntry(client, ev);
  }

  function cleanup(error)
  {
    var idx;

    if (error.code !== 'EPIPE')
      throw error;
    
    idx = registry.indexOf(client);
    if (idx !== -1)
      registry.splice(idx, 1);
    else
      console.warn(' * Warning: cleanup could not locate client in registry!');

    ci.off('any', handleConsoleEvents);
    client.off('error', cleanup);
    client.off('close', cleanup);
  }

  /* using the error event as a proxy for the close event here, because otherwise the
   * telnet package can try to write to the remote socket after its closed due to EPIPE,
   * but before the close event fires, resulting in an uncaught exception.
   */
  client.on('error', cleanup);
  client.on('close', cleanup);

  registry.push(client);
  ci.on('any', handleConsoleEvents);
  client.logBuffer = ci.buffer;
  
  try
  {
    client.on('window size', (ev) => doWinch(ev, client));
    if (debug)
      hookDebugTelnetEvents(client);
    client.setRawMode = setRawMode;         /* 'readline' will call `setRawMode` when it is a function */
    client.do.transmit_binary()             /* make unicode characters work properly */
    client.do.window_size();                /* emit 'window size' events */

    client.write(`Connected to ${process.argv[1]} on ${os.hostname()}; load=${os.loadavg()[0]}, running ${humanFriendlyTimeInterval(Math.floor(process.uptime()))}\n`);
    client.repl = require('repl').start(leafMerge(options, { socket: client, eval: evalWrapperFactory(options, client) }));
    if (options.histfile && client.repl.setupHistory)
      client.repl.setupHistory(expandPath(options.histfile), () => {});
    
    client.repl.on('reset', () => {
      try { client.write('REPL reset\n'); } catch(e){};
    });
    client.repl.on('exit', () => {
      try { client.write('REPL exit\n');  } catch(e){};
      try { client.end();                 } catch(e){};
    });

    client.logOff = options.logOff;
  }
  catch(error)
  {
    if (error.code !== 'EPIPE')
      throw error;
  }
}

/**
 * Create a per-client/repl [stateful] evalWrapper
 */
function evalWrapperFactory(options, client)
{
  var last;      /* last result from REPL */
  var keep = {}; /* ad-hoc storage for REPL user */
  
  /**
   * Evaluate a line of text from the REPL user; implement some special commands here.
   * 
   * @param     cmd     what the user typed
   */
  async function evalWrapper(cmd, context, filename, callback)
  {
    const myEval = options.eval;
    
    try
    {
      let [,firstWord,,rest] = cmd.match(/^(\w*)(\s*)(.*)(\n?)$/);
      let result;
      let prefixHnd = (x) => x;
      
      if (firstWord === 'keys')
      {
        if (rest.trim().length === 0)
        {
          firstWord = 'help';
        }
        else
        {
          cmd = rest;
          [,firstWord,,rest] = cmd.match(/^(\w*)(\s*)(.*)(\n?)$/);
          prefixHnd = (x) => Object.keys(x);
        }
      }
      
      try
      {
        if (commands && commands.hasOwnProperty(firstWord)) {
          result = commands[firstWord](rest, client, options);
          if (typeof result === 'object' && (rest[0] === '.' || rest[0] === '['))
            result = (myEval(`(x) => x${rest}`))(result);
        }
        else
        {
          let fn;
          if (cmd.match(/^\s+$/))
            cmd='undefined';
          fn = myEval(`"use strict"; (async (last, keep) => (${cmd}))`);
          result = fn(last, keep);
        }

        if (result instanceof Promise)
          result = await result;
        result = prefixHnd(result);
        callback(null, result);
        last = result;
      }
      catch(error)
      {
        callback(null, error);
      }
    }
    catch(e)
    {
      console.error('repl evalWrapper:', e);
    }
  }

  return evalWrapper;
}

/**
 * The equivalent of "raw mode" via telnet option commands.
 *
 * Allows configuration of `this` ReadStream so that it operates as a raw device.
 * When in raw mode, input is always available character-by-character, not including modifiers. 
 * Additionally, all special processing of characters by the terminal is disabled, including echoing 
 * input characters. Ctrl+C will no longer cause a SIGINT when in this mode.
 */
function setRawMode(mode)
{
  try
  {
    if (mode)
    {
      this.do.suppress_go_ahead();
      this.will.suppress_go_ahead();
      this.will.echo();
    }
    else
    {
      this.dont.suppress_go_ahead();
      this.wont.suppress_go_ahead();
      this.wont.echo();
    }
  }
  catch(error)
  {
    if (error.code !== 'EPIPE')
      throw error;
  }
}

/* Do a window-size change */
function doWinch(ev, client)
{
  if (ev.command === 'sb')     /* a real "resize" event; 'readline' listens for this */
  {
    client.columns = ev.columns;
    client.rows = ev.rows;
    client.emit('resize');
  }
}

function hookDebugTelnetEvents(client)
{
  client.on('suppress go ahead',        console.log);
  client.on('echo',                     console.log);
  client.on('window size',              console.log);
  client.on('x display location',       console.log);
  client.on('terminal speed',           console.log);
  client.on('environment variables',    console.log);
  client.on('transmit binary',          console.log);
  client.on('status',                   console.log);
  client.on('linemode',                 console.log);
  client.on('authentication',           console.log);
}        

function logCommand(arg, client, options)
{
  if (arg === 'on')
  {
    client.logOff = false;
    return 'log display enabled';
  }
  if (arg === 'off')
  {
    client.logOff = true;
    return 'log display disabled';
  }

  client.logBuffer.slice(-arg).forEach(entry => writeLogEntry(client, entry));
}

const defaultCommands = {
  stat: () => ({
    resources:  process.resourceUsage(),
    memory:     process.memoryUsage(),
    totalmem:   os.totalmem(),
  }),
  uptime: () => {
    let time = (new Date()).toLocaleTimeString('en-CA', { hour12: false });
    return `${time} up ${humanFriendlyTimeInterval(1000 * process.uptime())}, load average: ${os.loadavg().join(', ')}`;
  },
  whoami: () => ({
    process: path.basename(process.argv[1]),
    pid: process.pid,
    ppid: process.ppid,
    node: process.execPath,
    user: os.userInfo(),
  }),
  ifconfig:     os.networkInterfaces,
  raise: (signal) => process.kill(process.pid, signal || 0),
  flush: (iden) => delete require.cache[require.resolve(iden)],
  log: logCommand
};

const defaultHelp = {
  help:         'display this help - use "help cmd" to display help other commands',
  keep:         'object for ad-hoc storage',
  last:         'last result evaluated',
  keys:         'show keys of argument',
  uptime:       'show system uptime, load average',
  ifconfig:     'show network interfaces',
  whoami:       'show os-level info about running process',
  stat:         'show os-level statitics about running process',
  raise:        'send a signal to this process',
  flush:        'flush a module from the require cache (potentially very dangerous!!!)',
  log:          'on|off|N - enable, disable, show last N logs; no arg=show all'
};
