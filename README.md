# Telnet Console for NodeJS

A library for implementing runtime consoles in Node applications. This library allows you to 
trivially build a telnet daemon for your application that can buffer/intercept console log
messages and connect a REPL within a given execution context (usually the main program).

## Security Notes - IMPORTANT!!!

Telnet is unencrypted and unauthenticated. You should not run it across a network; for this 
reason, the default listen address for this library is localhost:2323.

Additionally, making the REPL available allows anyone who can connect to it to do anything
at all with the same privileges as your application -- so even if you are limiting connections
to localhost, you must also trust every single user on your machine.

We recommend only enabling a telnet console under controlled debugging conditions.

## How To Use
### tldr;
require('telnet-console').start();

### API
*start(options)*: Start the daemon with the given options object

#### options
| option          | default | details
|:----------------|:--------|:-------------------------------------------------------------------------------------
| port            | 2323    | port number to listen on; false to disable
| callbackTelnet  |         | callback to invoke when telnet daemon has started; receives (port, server, registry).
| callbackStdio   |         | callback to invoke when stdio repl has started
| histfile        |         | filename to REPL history into; understands ~, falsey to disable
| stdio           | false   | if not false, start a REPL on stdio also
| eval            |         | evaluator function to use with REPL. Use to get specific scope instead of global.

Note: all standard Node REPL options are also supported. See [NodeJS docs](https://nodejs.org/api/repl.html).
 
## Release Notes
* Jan 4 2021: Initial Release

### Supported Platforms
* Everything

### Related Products
* [`niim`](https://www.npmjs.com/package/niim) - a command-line debugger for Node.js 
  (fork of node-inspect) which can debug programs that need stdin connected to a 
  terminal (eg REPLs).
