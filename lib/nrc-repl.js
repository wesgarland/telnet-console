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
const debugging = true;
const { humanFriendlyTimeInterval } = require('./lib/human-friendly-time-interval');
const { leafMerge } = require('./lib/leaf-merge.js');
  
/** 
 * Start the REPL(s)
 * @param       {object}        serviceConfig           dcpConfig fragment; this function uses the .repl key inside the fragment for configuration.
 * @param       {function}      myEval                  An eval-like function that is used to evaluate REPL commands within the right scope.
 * @param       {object}        replHelpers...          One or more objects with two properties, 'commands' and 'help', where
 *                                                      - commands is an Object with key,value pairs of command,function of extra commands to add to the REPL
 *                                                      - help is an Object with key,value pairs of command,text of help for extra commands
 */
exports.start = function serviceRepl$$start(options, myEval, ...replHelpers)
{
  var help, commands;
  var last;      /* last result from REPL */
  var keep = {}; /* ad-hoc storage for REPL user */

  options = Object.assign({
    eval: evalWrapper,
    prompt: replConfig.prompt || '> ',
    useColors: true,
    ignoreUndefined: true,
    useGlobal: true,
  }, options);

  if (replConfig.port) {
    let telnetReplOptions = Object.assign(options, {
      terminal: true
    });

    global.telnetd = { clients: [], connections: [] };

    function serverMain(client)
    {
      try {
        let thisOptions = Object.assign(options, { socket: client });
        client.on('window size', function (e) {
          if (e.command === 'sb') {
            // a real "resize" event; 'readline' listens for this
            client.columns = e.columns
            client.rows = e.rows
            client.emit('resize')
          }
        })

        if (debugging('telnet'))
          hookDebugTelnetEvents(client);

        // 'readline' will call `setRawMode` when it is a function
        client.setRawMode = setRawMode

        // make unicode characters work properly
        client.do.transmit_binary()

        // emit 'window size' events
        client.do.window_size()
        
        client.write(`Connected to ${process.argv[1]} on ${os.hostname()}; load=${os.loadavg()[0]}, running ${humanFriendlyTimeInterval(Math.floor(process.uptime()))}\n`);
        if (process.env.DCP_SITE_CONFIG_FILES)
          client.write(`DCP_SITE_CONFIG_FILES=${process.env.DCP_SITE_CONFIG_FILES}\n`);
        client.repl = require('repl').start(thisOptions);
        if (options.histfile && client.repl.setupHistory)
          client.repl.setupHistory(require('dcp/utils').expandPath(options.histfile), () => {});
        
        client.repl.on('reset', () => {
          client.write('REPL reset\n');
        });
        client.repl.on('exit', () => {
          try {
            client.write('REPL exit\n');
            client.end();
          }
          catch(e){}
          finally{
            telnetd.clients.splice(telnetd.clients.indexOf(client), 1);
          }
        });

        telnetd.clients.push(client);
      } catch(e) {
        console.error(e);
      }
    };

    telnetd.server = telnet.createServer(serverMain).listen(options.port);
    telnetd.server.on('connection', (connection) => {
      telnetd.connections.push(connection);
      connection.on('end', () => {
        try {
          telnetd.clients.splice(telnetd.clients.indexOf(client), 1);
          telnetd.connections.splice(telnetd.clients.indexOf(connection), 1);
        } catch(e){};
      });
    });

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
    try
    {
      let [,firstWord,,rest] = cmd.match(/^(\w*)(\s*)(.*)(\n?)$/);
      let result;
      let prefixHnd = (x) => x;
      
      if (firstWord === 'keys')
      {
        cmd = rest;
        [,firstWord,,rest] = cmd.match(/^(\w*)(\s*)(.*)(\n?)$/);
        prefixHnd = (x) => Object.keys(x);
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
    let stdinReplOptions = Object.assign(options, { terminal: true });   
    let stdioRepl =  require('repl').start(stdinReplOptions);

    if (options.histfile && stdioRepl.setupHistory)
      stdioRepl.setupHistory(require('dcp/utils').expandPath(options.histfile), () => {});

    stdioRepl.on('exit', () => console.log('REPL exit'));
  }
}

/**
 * The equivalent of "raw mode" via telnet option commands.
 * Set this function on a telnet `client` instance.
 */
function setRawMode (mode)
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
