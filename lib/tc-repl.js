/**
 * @file        tc-repl.js - REPL startup code for the Telnet Console.
 *              
 * This library supports both stdio and telnetd runtime consoles. 
 * Invocation from within the main program allows evaluation of variables global to 
 * the main program:
 *
 * require('telnet-console').start(options, function tcEval() { return eval(arguments[0]) });
 *
 * Note: this library exists as a singleton.
 *
 * @author      Wes Garland, wes@kingsds.network
 * @date        Sep 2020, Jun 2021, Dec 2021
 */
'use strict';

const telnet = require('telnet');
const process = require('process');
const os = require('os');
const path = require('path');
const util = require('node:util');
const { humanFriendlyTimeInterval } = require('./human-friendly-time-interval');
const { leafMerge } = require('./leaf-merge');
const { expandPath } = require('./expand-path');
const debug = Boolean((process.env.DEBUG || '').indexOf('telnet') !== -1);
const { readln } = require('./readln');

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
 *
 * @returns the instance of ConsoleInterceptor that this daemon is using; can be used to reestablish interception when interrupted.
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
    bufferLines:     1000,
    users:           undefined, /* { login: password } or function(login,password) => bool */
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

  return ci;
}

/** 
 * Write a captured log entry to the given client.
 */
function writeLogEntry(client, entry)
{
  writeLogEntry.count = (writeLogEntry.count || 0) + 1;

  try
  {
    client.write('\x1b[0G\x1b[0J'); /* clear from start of current line to end of display */
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
    /* warning - using console here could trigger infinite recursion, let's try and be careful */;
    if (error.code === 'ERR_STREAM_WRITE_AFTER_END')
      client.cleanup();
    else if (writeLogEntry.count === 1)
      throw error;
  }
  finally
  {
    writeLogEntry.count--;
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
async function handleNewClient(client, ci, options)
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
    beforeWriteHandler(client);
    writeLogEntry(client, ev);
    afterWriteHandler(client);
  }

  /** 
   * Close a client connection (if still open) and cleanup resources
   */
  client.cleanup = function cleanup() {
    var idx;
    
    client.ci.off('any', handleConsoleEvents);
    client.off('error', cleanup);
    client.off('close', cleanup);

    client.destroy();
    
    idx = registry.indexOf(client);
    if (idx !== -1)
      registry.splice(idx, 1);
    else
      console.warn(' * Warning: cleanup could not locate client in registry!');
 
   client.cleanup = () => undefined;
  }

  /* using the error event as a proxy for the close event here, because otherwise the
   * telnet package can try to write to the remote socket after its closed due to EPIPE,
   * but before the close event fires, resulting in an uncaught exception.
   */
  client.on('error', () => client.cleanup());
  client.on('close', () => client.cleanup());

  registry.push(client);
  client.ci = ci;
  client.ci.on('any', handleConsoleEvents);
  client.logBuffer = client.ci.buffer;
  client.startTime = new Date();

  try
  {
    client.on('window size', (ev) => doWinch(ev, client));
    if (debug)
      hookDebugTelnetEvents(client);
    client.setRawMode = setRawMode;         /* 'readline' will call `setRawMode` when it is a function */
    client.do.terminal_type();              /* ask remote to send its $TERM along */
    client.do.transmit_binary();            /* make unicode characters work properly */
    client.do.window_size();                /* emit 'window size' events and initial terminal dimensions  */

    if (options.users)
    {
      let login, password;
      let tries = 0;
      let authFun;

      if (typeof options.users === 'function')
        authFun = options.users;
      else
        authFun = (login, password) => options.users[login] === password;

      client.logOff=true;
      do
      {
        client.write('login: ');
        login = await readln(client, true);
        client.write('password: ');
        password = await readln(client, false);
        client.write('\r\n');
        await sleepMs(Math.min(5000, 100 + 50 * Math.pow(4, tries++)));
      } while (login.length && authFun(login, password) !== true);

      client.login = login;
      client.write(`Welcome, ${client.login}! `);
    }
    client.logOff = options.logOff;
    client.write(`Connected to ${process.argv[1]} on ${os.hostname()}; load=${os.loadavg()[0]}, running ${humanFriendlyTimeInterval(1e3 * process.uptime())}\n`);
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
    client.repl.on('SIGTSTP', () => { }); /* disable daemon backgrounding on ^Z */
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

/** wipe out partially-typed REPL command just before we blit out a log line */
function beforeWriteHandler(client)
{
  if (!client.repl)
    return;
  
  const cursorPos = client.repl.getCursorPos();
  const prompt = client.repl.getPrompt ? client.repl.getPrompt() : client.repl._prompt;
  
  try
  {
    client.repl.pause();
    if (cursorPos.rows)
      client.write(`\x1b[A`.repeat(cursorPos.rows));
  }
  catch(error)
  {
    if (error.code === 'ERR_STREAM_WRITE_AFTER_END')
      client.cleanup();
    else
      throw error;
  }
}

/** restore partially-typed REPL command just after we blitted out a log line, and restore the cursor position */
function afterWriteHandler(client)
{
  if (!client.repl)
    return;

  const prompt = client.repl.getPrompt ? client.repl.getPrompt() : client.repl._prompt;
  const cursorPos = client.repl.getCursorPos();
  const cursor = cursorPos.rows * client.columns + cursorPos.cols;
  const lineLen = prompt.length + client.repl.line.length;

  try
  {
    if (cursor || client.repl.line)
    {
      let line = client.repl.line;
      client.write('\r\n'.repeat(cursorPos.rows));
      client.repl.prompt();
      client.repl.write(null, { ctrl: true, name: 'e' });
      for (let i=0; i < lineLen - cursor; i++)
        client.repl.write(null, { ctrl: true, name: 'b' });
    }
    else
      client.repl.resume();
  } 
  catch(error)
  {
    if (error.code === 'ERR_STREAM_WRITE_AFTER_END')
      client.cleanup();
    else
      throw error;
  }
}

function sleepMs(ms)
{
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Command which lets us toggle live logging state and see previous messages */
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

  beforeWriteHandler(client);
  client.logBuffer.slice(-arg).forEach(entry => writeLogEntry(client, entry));
  afterWriteHandler(client);
}

/** Command which shows who is logged into the daemon */
function whoCommand(arg, client, options)
{
  registry.forEach(c => client.write(`${c.remoteAddress}\t${c.startTime.toLocaleTimeString('en-CA', { hour12: false })}\t${c.login || ''}${c.logOff ? '\toff' : '\ton'}\r\n`));
  return registry.length + ' clients';
}

/** Command which allows us to send a message to all other connected users. */
function wallCommand(arg, client, options)
{
  registry.forEach(c => {
    if (c === client)
      return;
    beforeWriteHandler(c);
    c.write(`\x07*\x07*\x07* message from ${client.login ? client.login + '@' : ''}${client.remoteAddress}: ${arg} ***\r\n`)
    afterWriteHandler(c);
  });
  return 'message sent to ' + (registry.length - 1) + ' clients';
}

const defaultCommands = {
  stat: () => ({
    resources:  process.resourceUsage(),
    memory:     process.memoryUsage(),
    totalmem:   os.totalmem(),
  }),
  uptime: () => {
    let time = (new Date()).toLocaleTimeString('en-CA', { hour12: false });
    return `${time} up ${humanFriendlyTimeInterval(1e3 * process.uptime())}, load average: ${os.loadavg().join(', ')}`;
  },
  whoami: () => ({
    process: path.basename(process.argv[1]),
    pid: process.pid,
    ppid: process.ppid,
    node: process.execPath,
    user: os.userInfo(),
  }),
  ifconfig:     os.networkInterfaces,
  raise:        (signal) => process.kill(process.pid, +signal || signal || 0),
  flush:        (iden) => delete require.cache[require.resolve(iden)],
  log:          logCommand,
  who:          whoCommand,
  wall:         wallCommand,
  debug:        (arg, client, options) => { debugger },
  print:        async (arg, client, options) => {
    const result = options.eval(arg);
    let inspected = util.inspect(result, { colors: true });
    client.write('\x1b[0G\x1b[0J'); /* clear from start of current line to end of display */
    client.output.write(inspected.replace(/([^\r])\n/g, "$1\r\n") + "\r\n");
  },
};

const defaultHelp = {
  help:         'display this help - use "help cmd" to display help other commands',
  keep:         'object for ad-hoc storage',
  last:         'last result evaluated',
  keys:         'show keys of argument',
  uptime:       'show system uptime, load average',
  ifconfig:     'show network interfaces',
  whoami:       'show os-level info about running process',
  who:          'show who is conneted to this process',
  wall:         'write a message to all connected users',
  stat:         'show os-level statitics about running process',
  raise:        'send a signal to this process',
  flush:        'flush a module from the require cache (potentially very dangerous!!!)',
  log:          'on|off|N - enable, disable, show last N logs; no arg=show all',
  print:        'print argument value to telnet console',
};
