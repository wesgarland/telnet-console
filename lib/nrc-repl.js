/**
 * @file        nrc-repl.js - REPL startup code for nrc.
 *              
 * This library supports both stdio and telnetd runtime consoles. 
 * Invocation from within the main program allows evaluation of variables global to 
 * the main program:
 *
 * require('nrc').start(options, function nrcEval() { return eval(arguments[0]) });
 *
 * When the telnet mode is in use, a variable named `telnetd` is injected
 * into the global namespace so that it can inspected by REPL users.
 *
 * @author      Wes Garland, wes@kingsds.network
 * @date        Sep 2020, Jun 2021
 */
"use strict";

const telnet = require('telnet');
const process = require('process');
const os = require('os');
const path = require('path');
const { humanFriendlyTimeInterval } = require('./human-friendly-time-interval');
const { leafMerge } = require('./leaf-merge');
const { expandPath } = require('./expand-path');
const debug = false;

/** 
 * Start the REPL(s)
 * @param       {object}        options                 configuration options for configuring telnetd, 
 *                                                      the repl, etc. Options include:
 *                                                      - port:         tcp port to listen on or false
 *                                                      - eval:         eval-like function that is used
 *                                                                      to evaluate REPL commands in the 
 *                                                                      desired scope
 *                                                      - prompt:       REPL prompt string
 *                                                      - stding:       if true, start a repl on stdin
 *
 * @param       {object}        replHelpers...          One or more objects with two properties, 'commands' and 'help', where
 *                                                      - commands is an Object with key,value pairs of command,function of extra commands to add to the REPL
 *                                                      - help is an Object with key,value pairs of command,text of help for extra commands
 */
exports.start = function nrc$$start(options, ...replHelpers)
{
  const ci = new (require('./intercept-console').ConsoleInterceptor)({ inspect: { colors: true }});

  var help, commands;
  var last;      /* last result from REPL */
  var keep = {}; /* ad-hoc storage for REPL user */
  
  options = leafMerge({
    port:            2323,
    stdin:           false,
    eval:            /* indirect */ eval,
    prompt:          '> ',
    useColors:       true,
    ignoreUndefined: true,
    useGlobal:       true,
    terminal:        true,
    callbackTelnet:  false,
    callbackStdio:   false,
  }, options);

  if (options.port)
  {
    const registry = { clients: [], connections: [] };
    global.telnetd = registry;

    function handleNewClient(client)
    {
      global.telnetd.clients.push(client);
      
      try
      {
        client.on('window size', function doWinch(ev) {
          if (ev.command === 'sb') {             /* a real "resize" event; 'readline' listens for this */
            client.columns = ev.columns;
            client.rows = ev.rows;
            client.emit('resize');
          }
        })

        if (debug)
          hookDebugTelnetEvents(client);
        client.setRawMode = setRawMode;         /* 'readline' will call `setRawMode` when it is a function */
        client.do.transmit_binary()             /* make unicode characters work properly */
        client.do.window_size();                /* emit 'window size' events */

        client.write(`Connected to ${process.argv[1]} on ${os.hostname()}; load=${os.loadavg()[0]}, running ${humanFriendlyTimeInterval(Math.floor(process.uptime()))}\n`);
        client.repl = require('repl').start(leafMerge(options, { socket: client, eval: evalWrapper }));
        if (options.histfile && client.repl.setupHistory)
          client.repl.setupHistory(expandPath(options.histfile), () => {});
        
        client.repl.on('reset', () => {
          try { client.write('REPL reset\n'); } catch(e){};
        });
        client.repl.on('exit', () => {
          try { client.write('REPL exit\n');  } catch(e){};
          try { client.end();                 } catch(e){};
        });
      } catch(error) {
        if (error.code !== 'EPIPE')
          console.error('handleNewClient:', error);
      }

      if (options.callbackTelnet)
        options.callbackTelnet(options.port, client, registry);
    } /* end server main */

    const server = telnet.createServer(handleNewClient).listen(options.port);
    server.on('connection', (connection) => handleNewConnection(connection, ci, registry));
    if (!options.quiet)
      console.log(`Telnet REPL listening on ${options.port}`);
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

  /**
   * Evaluate a line of text from the REPL user
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
          result = commands[firstWord](rest, myEval);
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

  /* Start a REPL on stdio if it's a terminal */
  if (process.stdin.isTTY
      && options.stdin !== false
      && !(require('module')._cache.niim instanceof require('module').Module)
      && typeof process.env.DCP_SERVER_DISABLE_REPL !== 'string')
  {
    let stdioRepl =  require('repl').start(leafMerge(options, { eval: evalWrapper } ));

    if (options.histfile && stdioRepl.setupHistory)
      stdioRepl.setupHistory(expandPath(options.histfile), () => {});

    stdioRepl.on('exit', () => console.log('REPL exit'));
    if (options.callbackStdio)
      options.callbackStdio();
  }
}

/**
 * Handle a new connection.  Getting a handle on the client must be done via the
 * registry, as the event model in the telnet library does not provide an appropriate
 * handle.
 *
 * @param {object}      connection      the connection handle (implementation detail:
 *                                      we rely on this being the output socket)
 * @param {object}      ci              console-interceptor handle
 * @param {registry}    registry        per-server registry which contains known clients
 */
function handleNewConnection(connection, ci, registry)
{
  const client = registry.clients.find((client) => client.output === connection);

  /* using the error event as a proxy for the close event here, because otherwise the
   * telnet package can try to write to the remote socket after its closed due to EPIPE,
   * but before the close event fires, resulting in an uncaught exception.
   */
  client.on('error', cleanup);
  client.on('close', cleanup);

  function handleConsoleEvents(el)
  {
    try
    {
      connection.write(el.inspectedArguments.join(' ') + '\r\n');
    }
    catch(e)
    {
      /* using console here could trigger infinite recursion */;
    }
  }

  function cleanup()
  {
    var idx;

    idx = registry.connections.indexOf(connection);
    if (idx !== -1)
      registry.connections.splice(idx, 1);
    else
      console.warn(' * Warning: cleanup could not locate connection in registry!');
    idx = registry.clients.indexOf(client);
    if (idx !== -1)
      registry.clients.splice(idx, 1);
    else
      console.warn(' * Warning: cleanup could not locate client in registry!');

    ci.off('any', handleConsoleEvents);
    client.off('error', cleanup);
    client.off('close', cleanup);
  }
  
  registry.connections.push(connection);
  ci.on('any', handleConsoleEvents);
}


/**
 * The equivalent of "raw mode" via telnet option commands.
 * Set this function on a telnet `client` instance.
 */
function setRawMode (mode)
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
};
