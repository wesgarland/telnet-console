# Telnet Console for NodeJS

A library for implementing runtime consoles in Node applications. This library allows you to 
trivially build a telnet daemon for your application that can buffer/intercept console log
messages and connect a REPL within a given execution context (usually the main program).

## Security Notes - IMPORTANT!!!

Telnet is unencrypted and unauthenticated by default. You should not expose it to the internet, 
or any other network where you do not trust 100% of the hosts. Anything typed, including authentication
credentials, can be seen by sniffing the network traffic.

Additionally, making the REPL available allows anyone who can connect to it to do anything
at all with the same privileges as your application -- so even if you are limiting connections
to localhost, you must also trust every single user on your machine.

We recommend only enabling a telnet console under controlled debugging conditions.

## How To Use
### tldr;
*in your code*: 
```javascript
require('telnet-console').start();
````
*shell command*: 
```sh
telnet localhost 2323
```

More info in `examples/` directory; use the source, Luke!

### API
**start(options, ...replHelpers)**: Start the daemon with the given options object, returning an instance of ConsoleInterceptor

#### options
| option          | default | details
|:----------------|:--------|:-------------------------------------------------------------------------------------
| port            | 2323    | port number to listen on; false to disable
| callbackTelnet  |         | callback to invoke when telnet daemon has started; receives (port, server, registry).
| callbackStdio   |         | callback to invoke when stdio repl has started
| histfile        |         | filename to REPL history into; understands ~, falsey to disable
| stdio           | false   | if not false, start a REPL on stdio also
| eval            |         | evaluator function to use with REPL. Use to get specific scope instead of global.
| logOff          |         | true to not display log messages by default
| bufferLines     | 1000    | number of log lines to keep in memory for log command
| users           |         | a function which returns true for a valid login/password pair, or an object whose keys are logins and values are passwords

*Note:* all standard Node REPL options are also supported. See [NodeJS docs](https://nodejs.org/api/repl.html).

#### replHelpers
You can specify zero or more "helpers" to add custom commands to your server.  Each helper object can implement any
number of new commands. The property name becomes the command word, and the value of the property becomes the
function which is executed.

Each function which is executed receives the parameters `arg`, `client`, and `options`. The `arg` parameter is the
string that was typed after the command word. The `client` parameter is a handle to the output stream (i.e. the
connection to the remote end). The `options` parameter is the `options` argument that was passed to `start()`.

Each function should return undefined, which is ignored, or an object or string which will be displayed to the
remote user.  Using the `client` output stream is possible, but discouraged. If it is used, it is very important to
send \r\n instead of \n, and all output must end with \r\n to avoid corrupting the REPL.

**ConsoleIntercetor::reintercept()**: re-establish console.log (etc) interception if some other library intercepted it.

### Commands
* **help** - online help
* **log on** - console messages show in telnet client (default)
* **log off** - console messages don't show in telnet client
* **log N** - show the last N messages in the telnet client
* **log** - show entire log (up to `options.bufferLines` lines)
* **last** - last result evaluated (also variable `_`)
* **keys** - show Object.keys of argument
* **uptime** - show system uptime, load average
* **ifconfig** - show network interfaces
* **whoami** - show os-level info about running process
* **who** - show who is conneted to this process
* **wall** - write a message to all connected users
* **stat** - show os-level statitics about running process
* **raise** - send a signal to this process
* **flush** - flush a module from the require cache (potentially very dangerous!!!)

### Debugging Tips
#### keep
Every command entered in the REPL is evaluated in such a way as to minimize the possibility of having unintended
side-effects in the program under test. One side effect of this is that you can declare variable in the REPL. A
special variable, `keep`, is an object which has been provided so you have a place to stash things.
 
## Release Notes
* Jan 4 2021: Initial Release

### Supported Platforms
* Everything, >= current Node 12 LTS

### Related Products
* [`niim`](https://www.npmjs.com/package/niim) - a command-line debugger for Node.js 
  (fork of node-inspect) which can debug programs that need stdin connected to a 
  terminal (eg REPLs).
