# nrc - Node Runtime Console

A library for implementing runtime consoles in Node applications. This library allows you to 
trivially build a telnet daemon for your application that can buffer/intercept console log
messages and connect a REPL within a given execution context (usually the main program).

## Security Notes - IMPORTANT!!!

Telnet is unencrypted and unauthenticated. You should not run it across a network; for this 
reason, the default listen address for this library is localhost:2323.

Additionally, making the REPL available allows anyone who can connect to it to do anything
at all with the same privileges as your application -- so even if you are limiting connections
to localhost, you must also trust every single user on your machine.

We recommend only enabling nrc under controlled debugging conditions.

## Release Notes
* Unreleased

### Supported Platforms
* Everything

### Related Products
* [`niim`](https://www.npmjs.com/package/niim) - a command-line debugger for Node.js 
  (fork of node-inspect) which can debug programs that need stdin connected to a 
  terminal (eg REPLs).
